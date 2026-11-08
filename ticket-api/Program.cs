using System.Collections.Concurrent;
using System.Globalization;
using System.IO.Compression;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

const int MaxArchiveBytes = 10 * 1024 * 1024;
const string CookieName = "__Secure-nl_tickets";
const string CookiePath = "/api/tickets";
var settings = TicketSettings.FromEnvironment();
var store = new TicketStore(settings.DataPath);
var sessions = new TicketSessions(settings.SessionSecret, settings.AccessCode);
var attempts = new FailedAttempts();
var builder = WebApplication.CreateBuilder(args);
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = MaxArchiveBytes);
var app = builder.Build();

app.Use(async (context, next) =>
{
    context.Response.Headers.CacheControl = "private, no-store";
    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    await next(context);
});

app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

var api = app.MapGroup(CookiePath);
api.MapGet("/session", (HttpContext context) => Results.Ok(new { authenticated = IsUnlocked(context) }));

api.MapPost("/unlock", async (HttpContext context) =>
{
    if (!IsSameOrigin(context)) return Results.StatusCode(StatusCodes.Status403Forbidden);
    var client = IPAddress.TryParse(context.Request.Headers["X-Ticket-Client-IP"].ToString(), out var clientAddress)
        ? clientAddress.ToString()
        : context.Connection.RemoteIpAddress?.ToString() ?? "local";
    if (!attempts.IsAllowed(client))
    {
        context.Response.Headers.RetryAfter = "600";
        return Results.StatusCode(StatusCodes.Status429TooManyRequests);
    }

    UnlockRequest? request;
    try { request = await context.Request.ReadFromJsonAsync<UnlockRequest>(context.RequestAborted); }
    catch (JsonException) { return Results.BadRequest(new { error = "invalid_request" }); }
    if (!SecretEquals(request?.Code?.Trim(), settings.AccessCode))
    {
        attempts.Fail(client);
        await Task.Delay(150, context.RequestAborted);
        return Results.Json(new { error = "invalid_code" }, statusCode: StatusCodes.Status401Unauthorized);
    }

    context.Response.Cookies.Append(CookieName, sessions.Create(), CookieOptions());
    return Results.Ok(new { authenticated = true });
});

api.MapPost("/lock", (HttpContext context) =>
{
    if (!IsSameOrigin(context)) return Results.StatusCode(StatusCodes.Status403Forbidden);
    context.Response.Cookies.Delete(CookieName, CookieOptions());
    return Results.Ok(new { authenticated = false });
});

api.MapGet("/manifest", (HttpContext context) =>
{
    if (!IsUnlocked(context)) return Results.Unauthorized();
    var snapshot = store.Current;
    return snapshot is null ? Results.StatusCode(503) : Results.Json(snapshot.Manifest, TicketStore.JsonOptions);
});

api.MapGet("/files/{filename}", (string filename, HttpContext context) =>
{
    if (!IsUnlocked(context)) return Results.Unauthorized();
    var snapshot = store.Current;
    if (snapshot is null) return Results.StatusCode(503);
    if (!TicketStore.ValidFilename(filename) || !snapshot.Files.Contains(filename)) return Results.NotFound();
    var path = Path.Combine(snapshot.Directory, filename);
    return File.Exists(path)
        ? Results.File(path, "application/pdf", fileDownloadName: filename, enableRangeProcessing: false)
        : Results.NotFound();
});

api.MapPost("/admin/import", async (HttpContext context) =>
{
    var authorization = context.Request.Headers.Authorization.ToString();
    if (!authorization.StartsWith("Bearer ", StringComparison.Ordinal) ||
        !SecretEquals(authorization[7..], settings.AdminToken)) return Results.Unauthorized();
    if (!string.Equals(context.Request.ContentType?.Split(';')[0].Trim(), "application/zip", StringComparison.OrdinalIgnoreCase))
        return Results.StatusCode(StatusCodes.Status415UnsupportedMediaType);
    if (context.Request.ContentLength > MaxArchiveBytes) return Results.StatusCode(413);

    try
    {
        using var data = new MemoryStream();
        var buffer = new byte[64 * 1024];
        int bytes;
        while ((bytes = await context.Request.Body.ReadAsync(buffer, context.RequestAborted)) > 0)
        {
            if (data.Length + bytes > MaxArchiveBytes) return Results.StatusCode(413);
            await data.WriteAsync(buffer.AsMemory(0, bytes), context.RequestAborted);
        }
        data.Position = 0;
        var count = await store.Import(data, context.RequestAborted);
        return Results.Ok(new { imported = count });
    }
    catch (Exception error) when (error is InvalidDataException or JsonException or FormatException)
    {
        return Results.BadRequest(new { error = "invalid_archive" });
    }
});

app.Run();

bool IsUnlocked(HttpContext context) => sessions.Validate(context.Request.Cookies[CookieName]);
bool IsSameOrigin(HttpContext context) => string.Equals(context.Request.Headers.Origin.ToString(), settings.PublicOrigin, StringComparison.Ordinal);
static bool SecretEquals(string? provided, string expected) => provided is not null &&
    provided.Length <= 512 && CryptographicOperations.FixedTimeEquals(
        SHA256.HashData(Encoding.UTF8.GetBytes(provided)), SHA256.HashData(Encoding.UTF8.GetBytes(expected)));
static CookieOptions CookieOptions() => new()
{
    Path = CookiePath,
    HttpOnly = true,
    Secure = true,
    SameSite = SameSiteMode.Strict,
    MaxAge = TimeSpan.FromHours(12),
    IsEssential = true
};

sealed record UnlockRequest(string? Code);

sealed record TicketSettings(string AccessCode, string AdminToken, string SessionSecret, string PublicOrigin, string DataPath)
{
    public static TicketSettings FromEnvironment()
    {
        static string Required(string name, int minimum)
        {
            var value = Environment.GetEnvironmentVariable(name);
            if (string.IsNullOrWhiteSpace(value) || value.Length < minimum)
                throw new InvalidOperationException($"Required setting {name} is missing or too short.");
            return value;
        }
        var origin = Required("TICKETS_PUBLIC_ORIGIN", 8).TrimEnd('/');
        if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri) ||
            (uri.Scheme != "https" && !(uri.Scheme == "http" && uri.IsLoopback)) ||
            origin != uri.GetLeftPart(UriPartial.Authority))
            throw new InvalidOperationException("TICKETS_PUBLIC_ORIGIN must be an HTTPS origin.");
        return new(Required("TICKETS_ACCESS_CODE", 8), Required("TICKETS_ADMIN_TOKEN", 32),
            Required("TICKETS_SESSION_SECRET", 32), origin,
            Environment.GetEnvironmentVariable("TICKETS_DATA_PATH") ?? "/data/tickets");
    }
}

sealed class TicketSessions
{
    private readonly byte[] key;
    public TicketSessions(string secret, string accessCode) =>
        key = HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(accessCode));

    public string Create()
    {
        var payload = $"{DateTimeOffset.UtcNow.AddHours(12).ToUnixTimeSeconds()}.{Convert.ToHexString(RandomNumberGenerator.GetBytes(24))}";
        return payload + "." + Convert.ToHexString(HMACSHA256.HashData(key, Encoding.UTF8.GetBytes(payload)));
    }

    public bool Validate(string? token)
    {
        if (string.IsNullOrEmpty(token) || token.Length > 200) return false;
        var parts = token.Split('.');
        if (parts.Length != 3 || !long.TryParse(parts[0], out var expiry) ||
            expiry <= DateTimeOffset.UtcNow.ToUnixTimeSeconds() ||
            expiry > DateTimeOffset.UtcNow.AddHours(12).ToUnixTimeSeconds() || parts[1].Length != 48) return false;
        try
        {
            var signature = Convert.FromHexString(parts[2]);
            var expected = HMACSHA256.HashData(key, Encoding.UTF8.GetBytes(parts[0] + "." + parts[1]));
            return CryptographicOperations.FixedTimeEquals(signature, expected);
        }
        catch (FormatException) { return false; }
    }
}

sealed class FailedAttempts
{
    private readonly ConcurrentDictionary<string, (DateTimeOffset Start, int Count)> attempts = new();
    public bool IsAllowed(string client) => !attempts.TryGetValue(client, out var entry) ||
        DateTimeOffset.UtcNow - entry.Start >= TimeSpan.FromMinutes(10) || entry.Count < 10;

    public void Fail(string client)
    {
        var now = DateTimeOffset.UtcNow;
        if (attempts.Count > 1000)
            foreach (var item in attempts.Where(item => now - item.Value.Start >= TimeSpan.FromMinutes(10)))
                attempts.TryRemove(item.Key, out _);
        attempts.AddOrUpdate(client, (now, 1), (_, old) => now - old.Start >= TimeSpan.FromMinutes(10)
            ? (now, 1) : (old.Start, old.Count + 1));
    }
}

sealed record TicketManifest(List<TicketEntry> Tickets);
sealed record TicketEntry(string Filename, Dictionary<string, string> Title,
    Dictionary<string, string> Description, string Direction, string Kind, int Passengers, string Sha256,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] List<TicketJourneyLink>? Journeys = null);
sealed record TicketJourneyLink(string Id, string Direction, string Date, string Mode);
sealed record TicketSnapshot(string Directory, TicketManifest Manifest, HashSet<string> Files);

sealed class TicketStore
{
    public static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private const int Limit = 10 * 1024 * 1024;
    private const int MaxTickets = 50;
    private readonly string root;
    private readonly SemaphoreSlim importLock = new(1, 1);
    private TicketSnapshot? current;
    public TicketSnapshot? Current => Volatile.Read(ref current);

    public TicketStore(string root)
    {
        this.root = Path.GetFullPath(root);
        Directory.CreateDirectory(this.root);
        var pointer = Path.Combine(this.root, "active-generation");
        if (File.Exists(pointer))
        {
            var generation = File.ReadAllText(pointer);
            if (!Regex.IsMatch(generation, "^generation-[a-f0-9]{32}$", RegexOptions.CultureInvariant))
                throw new InvalidDataException("Invalid stored ticket generation.");
            var directory = Path.Combine(this.root, generation);
            var manifest = JsonSerializer.Deserialize<TicketManifest>(File.ReadAllText(Path.Combine(directory, "manifest.json")), JsonOptions)
                ?? throw new InvalidDataException("Missing ticket manifest.");
            ValidateManifest(manifest);
            current = Snapshot(directory, manifest);
        }
    }

    public static bool ValidFilename(string? filename) => filename is not null && filename.Length <= 180 &&
        Regex.IsMatch(filename, "^[a-z0-9][a-z0-9-]*\\.pdf$", RegexOptions.CultureInvariant);

    public async Task<int> Import(Stream stream, CancellationToken cancellationToken)
    {
        using var archive = new ZipArchive(stream, ZipArchiveMode.Read, leaveOpen: true);
        if (archive.Entries.Count is < 2 or > MaxTickets + 1 || archive.Entries.Sum(entry => entry.Length) > Limit)
            throw new InvalidDataException("Invalid archive size.");
        var entries = new Dictionary<string, ZipArchiveEntry>(StringComparer.Ordinal);
        foreach (var entry in archive.Entries)
        {
            if ((entry.FullName != "manifest.json" && !ValidFilename(entry.FullName)) ||
                ((entry.ExternalAttributes >> 16) & 0xF000) == 0xA000 || !entries.TryAdd(entry.FullName, entry))
                throw new InvalidDataException("Invalid archive entry.");
        }
        if (!entries.TryGetValue("manifest.json", out var manifestEntry) || manifestEntry.Length > 128 * 1024)
            throw new InvalidDataException("Invalid manifest.");
        var manifestBytes = await ReadEntry(manifestEntry, 128 * 1024, cancellationToken);
        var manifest = JsonSerializer.Deserialize<TicketManifest>(manifestBytes, JsonOptions)
            ?? throw new InvalidDataException("Missing manifest.");
        ValidateManifest(manifest);
        var expectedFiles = manifest.Tickets.Select(ticket => ticket.Filename).ToHashSet(StringComparer.Ordinal);
        if (entries.Count != expectedFiles.Count + 1 ||
            entries.Keys.Any(filename => filename != "manifest.json" && !expectedFiles.Contains(filename)))
            throw new InvalidDataException("Archive contents do not match the manifest.");

        var validated = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        foreach (var ticket in manifest.Tickets)
        {
            if (!entries.TryGetValue(ticket.Filename, out var entry)) throw new InvalidDataException("Missing PDF.");
            var bytes = await ReadEntry(entry, Limit, cancellationToken);
            if (bytes.Length < 5 || !bytes.AsSpan(0, 5).SequenceEqual("%PDF-"u8) ||
                !CryptographicOperations.FixedTimeEquals(SHA256.HashData(bytes), Convert.FromHexString(ticket.Sha256)))
                throw new InvalidDataException("Invalid PDF or checksum.");
            validated.Add(ticket.Filename, bytes);
        }

        await importLock.WaitAsync(cancellationToken);
        try
        {
            var generation = "generation-" + Guid.NewGuid().ToString("N");
            var directory = Path.Combine(root, generation);
            Directory.CreateDirectory(directory);
            foreach (var (filename, bytes) in validated)
                await File.WriteAllBytesAsync(Path.Combine(directory, filename), bytes, cancellationToken);
            await File.WriteAllTextAsync(Path.Combine(directory, "manifest.json"), JsonSerializer.Serialize(manifest, JsonOptions), cancellationToken);
            var pointer = Path.Combine(root, "active-generation");
            var temporaryPointer = pointer + "." + Guid.NewGuid().ToString("N");
            await File.WriteAllTextAsync(temporaryPointer, generation, cancellationToken);
            File.Move(temporaryPointer, pointer, overwrite: true);
            Volatile.Write(ref current, Snapshot(directory, manifest));
            return validated.Count;
        }
        finally { importLock.Release(); }
    }

    private static TicketSnapshot Snapshot(string directory, TicketManifest manifest) =>
        new(directory, manifest, manifest.Tickets.Select(ticket => ticket.Filename).ToHashSet(StringComparer.Ordinal));

    private static async Task<byte[]> ReadEntry(ZipArchiveEntry entry, int limit, CancellationToken cancellationToken)
    {
        await using var source = entry.Open();
        using var data = new MemoryStream();
        var buffer = new byte[64 * 1024];
        int count;
        while ((count = await source.ReadAsync(buffer, cancellationToken)) > 0)
        {
            if (data.Length + count > limit || data.Length + count > entry.Length)
                throw new InvalidDataException("Archive entry exceeds its size limit.");
            await data.WriteAsync(buffer.AsMemory(0, count), cancellationToken);
        }
        if (data.Length != entry.Length) throw new InvalidDataException("Invalid archive entry length.");
        return data.ToArray();
    }

    private static void ValidateManifest(TicketManifest manifest)
    {
        if (manifest.Tickets is null || manifest.Tickets.Count is < 1 or > MaxTickets)
            throw new InvalidDataException("Expected between one and fifty tickets.");
        var names = new HashSet<string>(StringComparer.Ordinal);
        var journeys = new Dictionary<string, TicketJourneyLink>(StringComparer.Ordinal);
        foreach (var ticket in manifest.Tickets)
        {
            if (ticket is null || !ValidFilename(ticket.Filename) || !names.Add(ticket.Filename) ||
                ticket.Passengers is < 1 or > 100 || ticket.Direction is not ("outbound" or "return" or "roundtrip") ||
                ticket.Kind is not ("ticket" or "reservation") ||
                ticket.Sha256 is null || !Regex.IsMatch(ticket.Sha256, "^[a-fA-F0-9]{64}$", RegexOptions.CultureInvariant) ||
                !ValidLocalized(ticket.Title, 300) || !ValidLocalized(ticket.Description, 2000))
                throw new InvalidDataException("Invalid ticket metadata.");
            if (ticket.Journeys is null) continue;
            if (ticket.Journeys.Count is < 1 or > 4) throw new InvalidDataException("Invalid journey links.");
            var ticketJourneyIds = new HashSet<string>(StringComparer.Ordinal);
            foreach (var journey in ticket.Journeys)
            {
                if (journey is null || journey.Id is null || journey.Id.Length > 80 ||
                    !Regex.IsMatch(journey.Id, "^[a-z0-9][a-z0-9-]*$", RegexOptions.CultureInvariant) ||
                    !ticketJourneyIds.Add(journey.Id) || journey.Direction is not ("outbound" or "return") ||
                    journey.Mode is not ("train" or "bus") ||
                    !DateOnly.TryParseExact(journey.Date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _) ||
                    (ticket.Direction != "roundtrip" && ticket.Direction != journey.Direction))
                    throw new InvalidDataException("Invalid journey metadata.");
                if (journeys.TryGetValue(journey.Id, out var existing) && existing != journey)
                    throw new InvalidDataException("Conflicting journey metadata.");
                journeys[journey.Id] = journey;
            }
        }
    }

    private static bool ValidLocalized(Dictionary<string, string>? values, int limit) => values is not null &&
        new[] { "da", "en", "nl" }.All(language => values.TryGetValue(language, out var text) &&
            !string.IsNullOrWhiteSpace(text) && text.Length <= limit);
}
