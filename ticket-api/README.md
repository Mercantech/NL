# Beskyttede rejsebilletter

Lille .NET 10-filservice til holdets faelles rejsekode. Der oprettes ingen brugerkonti.
PDF'er og den aktive billetoversigt ligger i et persistent volume, aldrig i Git eller nginx' offentlige filer.

## Konfiguration

Saet foelgende via miljoevariable/Dokploy:

| Variabel | Krav |
| --- | --- |
| `TICKETS_ACCESS_CODE` | Mindst 8 tegn; den faelles kode deles kun med holdet. |
| `TICKETS_ADMIN_TOKEN` | Mindst 32 tegn; brug en tilfaeldig administrativ hemmelighed. |
| `TICKETS_SESSION_SECRET` | Mindst 32 tegn; brug en anden tilfaeldig hemmelighed. |
| `TICKETS_PUBLIC_ORIGIN` | Sidens praecise HTTPS-origin uden sti, fx `https://nl.mercantec.tech`. HTTP tillades kun for loopback under lokal test. |
| `TICKETS_DATA_PATH` | Valgfri; standard `/data/tickets`. Mount et named volume her. |

Servicen stopper ved manglende eller ugyldig konfiguration. Containeren lytter internt paa port 8080 og koerer som .NET-imagets ikke-root-bruger. Eksponer kun nginx; API'en skal alene vaere paa stackens private netvaerk.

## Endpoints

Alle API-svar bruger `Cache-Control: private, no-store` og `X-Content-Type-Options: nosniff`.

| Endpoint | Adgang og svar |
| --- | --- |
| `GET /health` | Offentlig container-health; `{ "status": "ok" }`. |
| `GET /api/tickets/session` | `{ "authenticated": true/false }`; afslører ingen billetter. |
| `POST /api/tickets/unlock` | JSON `{ "code": "..." }` og praecis `Origin`; korrekt kode giver signeret HttpOnly/Secure/SameSite=Strict-cookie i 12 timer. Forkert kode giver 401. Efter 10 fejl inden for 10 minutter giver yderligere forsoeg 429. Korrekte koder bruger ikke fejlkvoten. |
| `POST /api/tickets/lock` | Praecis `Origin`; sletter adgangscookien. |
| `GET /api/tickets/manifest` | Kraever gyldig cookie; returnerer billetoversigten, ellers 401. Ingen importeret generation giver 503. |
| `GET /api/tickets/files/{filename}` | Kraever gyldig cookie og et filnavn fra den aktive oversigt. Leverer PDF som download. Ukendt/ugyldigt filnavn giver 404. |
| `POST /api/tickets/admin/import` | Kraever `Authorization: Bearer ...` med admin-token samt `Content-Type: application/zip`. Ingen cookie eller Origin er noedvendig for denne serveradministrative operation. Returnerer `{ "imported": 10 }`. |

Adgangscookien er signeret med en noegle afledt af baade sessionhemmelighed og faelles kode. Rotation af en af dem ugyldiggoer eksisterende cookies.

Fejlgraensen bruger klient-IP'en i `X-Ticket-Client-IP`. Nginx skal altid overskrive denne dedikerede header med den faktiske klient-IP (Cloudflare-klient-IP eller forbindelsens afsender-IP). API'en validerer headeren som en enkelt IP-adresse og bruger forbindelsens afsender-IP ved manglende/ugyldig header. Denne tillid kraever, at API'en kun kan tilgaas fra stackens private netvaerk uden offentlig port. Dermed kan fejl fra en elev ikke spaerre elever paa andre klient-IP'er. Nginx boer desuden begraense unlock-forsoeg pr. faktisk klient-IP. API'en tillader ingen CORS-origins.

## Billetimport

ZIP-filen maa hoejst vaere 10 MiB baade komprimeret og udpakket. Den skal have praecis 11 filer direkte i roden: `manifest.json` og 10 PDF'er. Mapper, symlinks, dubletter og andre filer afvises. PDF-filnavne maa kun indeholde smaa ASCII-bogstaver, cifre og bindestreger samt endelsen `.pdf`.

Oversigten har denne struktur:

```json
{
  "tickets": [
    {
      "filename": "2026-11-14-tog-viborg-kolding-8-personer-gruppe-1.pdf",
      "title": { "da": "...", "en": "...", "nl": "..." },
      "description": { "da": "...", "en": "...", "nl": "..." },
      "direction": "outbound",
      "kind": "ticket",
      "passengers": 8,
      "sha256": "64 hextegn for den originale PDF"
    }
  ]
}
```

`direction` er `outbound`, `return` eller `roundtrip`; `kind` er `ticket` eller `reservation`. Alle tre sprog skal vaere udfyldt. PDF-signatur og SHA-256 valideres foer publicering. En ny generation aktiveres atomisk, saa en afbrudt/ugyldig import ikke overskriver den eksisterende samling. Tidligere generationer beholdes i det private volume, saa samtidige downloads ikke brydes.

## Lokal kontrol

```powershell
python ticket-api/tests/smoke.py
```

Testen bygger servicen og koerer rigtig lokal Kestrel med midlertidige hemmeligheder og testfiler. Den kontrollerer adgang, Origin, cookies, alle 10 downloads, importrettigheder, checksums, path traversal, atomisk udskiftning, genstart, logout, rotation af kode og fejlbegraensning. Den bruger ingen produktionsbilletter eller produktionshemmeligheder.
