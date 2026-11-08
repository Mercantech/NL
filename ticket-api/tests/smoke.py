"""Exercise the real Kestrel service with temporary credentials and ticket storage."""
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import hashlib
import io
import json
import os
import secrets
import socket
import subprocess
import time
import zipfile


PROJECT = Path(__file__).resolve().parents[1]
DLL = PROJECT / "bin/Release/net10.0/TicketApi.dll"
ORIGIN = "https://tickets.example.test"


def make_archive(corrupt_hash=False, unsafe_name=False, replacement=False, ticket_count=10,
                 include_journeys=False, unlisted_file=False, inconsistent_journey=False,
                 duplicate_journey=False, invalid_journey_date=False):
    files = {}
    tickets = []
    for number in range(ticket_count):
        name = f"2026-11-14-test-ticket-{number}.pdf"
        payload = b"%PDF-1.7\n" + f"test {number} replacement={replacement}".encode()
        files[name] = payload
        tickets.append({
            "filename": name,
            "title": {language: f"Ticket {number}" for language in ["da", "en", "nl"]},
            "description": {language: "Test journey" for language in ["da", "en", "nl"]},
            "direction": "outbound", "kind": "ticket", "passengers": 1,
            "sha256": hashlib.sha256(payload).hexdigest(),
        })
        if include_journeys:
            tickets[-1]["journeys"] = [{"id": "train-outbound", "direction": "outbound",
                                        "date": "2026-11-14", "mode": "train"}]
    if include_journeys and tickets:
        # One original PDF can be linked to both bus journeys without being duplicated in storage.
        tickets[-1]["direction"] = "roundtrip"
        tickets[-1]["journeys"] = [
            {"id": "bus-outbound", "direction": "outbound", "date": "2026-11-15", "mode": "bus"},
            {"id": "bus-return", "direction": "return", "date": "2026-11-26", "mode": "bus"},
        ]
    if inconsistent_journey:
        tickets[1]["journeys"][0]["date"] = "2026-11-15"
    if duplicate_journey:
        tickets[0]["journeys"].append(dict(tickets[0]["journeys"][0]))
    if invalid_journey_date:
        tickets[0]["journeys"][0]["date"] = "2026-02-30"
    if corrupt_hash:
        tickets[0]["sha256"] = "0" * 64
    if unsafe_name:
        payload = files.pop(tickets[0]["filename"])
        tickets[0]["filename"] = "../escape.pdf"
        files["../escape.pdf"] = payload
    if unlisted_file:
        files["unlisted.pdf"] = b"%PDF-1.7\nnot listed"
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("manifest.json", json.dumps({"tickets": tickets}))
        for name, payload in files.items():
            archive.writestr(name, payload)
    return stream.getvalue(), files


def main():
    subprocess.run(["dotnet", "build", str(PROJECT / "TicketApi.csproj"), "-c", "Release", "--nologo"], check=True)
    with TemporaryDirectory(prefix="nl-ticket-api-smoke-") as temporary:
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        base = f"http://127.0.0.1:{port}"
        environment = os.environ.copy()
        environment.update({
            "ASPNETCORE_URLS": base,
            "TICKETS_ACCESS_CODE": secrets.token_hex(12),
            "TICKETS_ADMIN_TOKEN": secrets.token_hex(32),
            "TICKETS_SESSION_SECRET": secrets.token_hex(32),
            "TICKETS_PUBLIC_ORIGIN": ORIGIN,
            "TICKETS_DATA_PATH": str(Path(temporary) / "data"),
        })
        process = None

        def request(path, method="GET", body=None, headers=None, cookie=None, origin=None):
            request_headers = dict(headers or {})
            if cookie:
                request_headers["Cookie"] = cookie
            if origin:
                request_headers["Origin"] = origin
            if isinstance(body, dict):
                body = json.dumps(body).encode()
                request_headers["Content-Type"] = "application/json"
            req = Request(base + path, data=body, method=method, headers=request_headers)
            try:
                response = urlopen(req, timeout=10)
            except HTTPError as error:
                response = error
            return response.status, response.headers, response.read()

        def start():
            nonlocal process
            process = subprocess.Popen(["dotnet", str(DLL)], cwd=PROJECT, env=environment,
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            for _ in range(100):
                try:
                    if request("/health")[0] == 200:
                        return
                except (URLError, ConnectionError):
                    pass
                if process.poll() is not None:
                    raise RuntimeError("Service exited during startup")
                time.sleep(0.1)
            raise TimeoutError("Service did not become healthy")

        def stop():
            nonlocal process
            if process:
                process.terminate()
                process.wait(timeout=10)
                process = None

        try:
            start()
            assert json.loads(request("/api/tickets/session")[2]) == {"authenticated": False}
            status, headers, _ = request("/api/tickets/manifest")
            assert status == 401 and "no-store" in headers["Cache-Control"]
            assert request("/api/tickets/files/2026-11-14-test-ticket-0.pdf")[0] == 401
            assert request("/api/tickets/unlock", "POST", {"code": environment["TICKETS_ACCESS_CODE"]})[0] == 403
            assert request("/api/tickets/unlock", "POST", {"code": environment["TICKETS_ACCESS_CODE"]}, origin="https://other.example")[0] == 403
            assert request("/api/tickets/unlock", "POST", {"code": "wrong-code"}, origin=ORIGIN)[0] == 401
            status, headers, body = request("/api/tickets/unlock", "POST", {"code": environment["TICKETS_ACCESS_CODE"]}, origin=ORIGIN)
            assert status == 200 and json.loads(body)["authenticated"]
            set_cookie = headers["Set-Cookie"]
            assert all(flag in set_cookie.lower() for flag in ["secure", "httponly", "samesite=strict", "path=/api/tickets", "max-age=43200"])
            cookie = set_cookie.split(";", 1)[0]
            assert json.loads(request("/api/tickets/session", cookie=cookie)[2])["authenticated"]
            forged = cookie[:-1] + ("0" if cookie[-1] != "0" else "1")
            assert request("/api/tickets/manifest", cookie=forged)[0] == 401

            archive, files = make_archive()
            upload_headers = {"Content-Type": "application/zip", "Authorization": "Bearer " + environment["TICKETS_ADMIN_TOKEN"]}
            assert request("/api/tickets/admin/import", "POST", archive, {"Content-Type": "application/zip"})[0] == 401
            assert request("/api/tickets/admin/import", "POST", archive, {**upload_headers, "Authorization": "Bearer wrong"})[0] == 401
            assert request("/api/tickets/admin/import", "POST", archive, {**upload_headers, "Content-Type": "text/plain"})[0] == 415
            assert request("/api/tickets/admin/import", "POST", archive, upload_headers)[0] == 200
            manifest = json.loads(request("/api/tickets/manifest", cookie=cookie)[2])
            assert len(manifest["tickets"]) == 10
            for filename, expected in files.items():
                status, headers, actual = request("/api/tickets/files/" + filename, cookie=cookie)
                assert status == 200 and actual == expected
                assert headers["Content-Type"] == "application/pdf"
                assert "attachment" in headers["Content-Disposition"] and filename in headers["Content-Disposition"]
                assert "no-store" in headers["Cache-Control"] and headers["X-Content-Type-Options"] == "nosniff"
            assert request("/api/tickets/files/missing.pdf", cookie=cookie)[0] == 404
            for path in ["/api/tickets/files/..%2factive-generation", "/api/tickets/files/%2e%2e%252factive-generation"]:
                assert request(path, cookie=cookie)[0] == 404
            for invalid_archive in [b"not-a-zip", make_archive(corrupt_hash=True)[0],
                                    make_archive(unsafe_name=True)[0], make_archive(unlisted_file=True)[0],
                                    make_archive(ticket_count=0)[0], make_archive(ticket_count=51)[0],
                                    make_archive(include_journeys=True, inconsistent_journey=True)[0],
                                    make_archive(include_journeys=True, duplicate_journey=True)[0],
                                    make_archive(include_journeys=True, invalid_journey_date=True)[0]]:
                assert request("/api/tickets/admin/import", "POST", invalid_archive, upload_headers)[0] == 400
            assert request("/api/tickets/files/" + next(iter(files)), cookie=cookie)[2] == next(iter(files.values()))

            # Existing ten-file generations remain readable after a restart with the extended schema.
            stop()
            start()
            legacy_manifest = json.loads(request("/api/tickets/manifest", cookie=cookie)[2])
            assert len(legacy_manifest["tickets"]) == 10
            assert all("journeys" not in ticket for ticket in legacy_manifest["tickets"])

            for count in [1, 50]:
                boundary_archive, _ = make_archive(ticket_count=count)
                status, _, body = request("/api/tickets/admin/import", "POST", boundary_archive, upload_headers)
                assert status == 200 and json.loads(body) == {"imported": count}
                assert len(json.loads(request("/api/tickets/manifest", cookie=cookie)[2])["tickets"]) == count

            replacement, replacement_files = make_archive(replacement=True, ticket_count=12, include_journeys=True)
            assert request("/api/tickets/admin/import", "POST", replacement, upload_headers)[0] == 200
            stop()
            start()
            extended_manifest = json.loads(request("/api/tickets/manifest", cookie=cookie)[2])
            assert len(extended_manifest["tickets"]) == 12
            assert len(extended_manifest["tickets"][-1]["journeys"]) == 2
            assert extended_manifest["tickets"][-1]["journeys"][1] == {
                "id": "bus-return", "direction": "return", "date": "2026-11-26", "mode": "bus"}
            filename = next(iter(replacement_files))
            assert request("/api/tickets/files/" + filename, cookie=cookie)[2] == replacement_files[filename]
            assert request("/api/tickets/lock", "POST", cookie=cookie, origin="https://other.example")[0] == 403
            status, headers, _ = request("/api/tickets/lock", "POST", cookie=cookie, origin=ORIGIN)
            assert status == 200 and "expires=thu, 01 jan 1970" in headers["Set-Cookie"].lower()
            assert json.loads(request("/api/tickets/session")[2]) == {"authenticated": False}

            # Only failed attempts count, so a group using the correct code does not exhaust the limit.
            for _ in range(25):
                assert request("/api/tickets/unlock", "POST", {"code": environment["TICKETS_ACCESS_CODE"]}, origin=ORIGIN)[0] == 200
            client_a = {"X-Ticket-Client-IP": "192.0.2.10"}
            client_b = {"X-Ticket-Client-IP": "192.0.2.11"}
            for _ in range(10):
                assert request("/api/tickets/unlock", "POST", {"code": "wrong-code"}, headers=client_a, origin=ORIGIN)[0] == 401
            status, headers, _ = request("/api/tickets/unlock", "POST", {"code": "wrong-code"}, headers=client_a, origin=ORIGIN)
            assert status == 429 and headers["Retry-After"] == "600"
            assert request("/api/tickets/unlock", "POST", {"code": environment["TICKETS_ACCESS_CODE"]}, headers=client_a, origin=ORIGIN)[0] == 429
            assert request("/api/tickets/unlock", "POST", {"code": environment["TICKETS_ACCESS_CODE"]}, headers=client_b, origin=ORIGIN)[0] == 200
            # Invalid or absent forwarding data falls back to the actual connection address.
            assert request("/api/tickets/unlock", "POST", {"code": environment["TICKETS_ACCESS_CODE"]}, headers={"X-Ticket-Client-IP": "not-an-ip"}, origin=ORIGIN)[0] == 200
            assert request("/api/tickets/unlock", "POST", {"code": environment["TICKETS_ACCESS_CODE"]}, origin=ORIGIN)[0] == 200
            stop()
            environment["TICKETS_ACCESS_CODE"] = secrets.token_hex(12)
            start()
            assert not json.loads(request("/api/tickets/session", cookie=cookie)[2])["authenticated"]
            print("PASS: authorization, origins, signed cookies, protected downloads, 1-50 file atomic import, legacy restart, 12-file journey metadata, unlisted-file rejection, hashes, traversal, logout and per-client rate limit")
        finally:
            stop()


if __name__ == "__main__":
    main()
