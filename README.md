# TerAA × Mercantec Colab

Info- og programsite for Helmond–Viborg-udvekslingen. Live: **https://nl.mercantec.tech**

## Sider

- `index.html` — program, steder, praktisk info, kontakt
- `qa.html` — Q&A til danske elever (dansk)
- `pakkeliste.html` — pakke-checkliste til danske elever
- `billetter.html` — kodebeskyttede billetter med beskrivende titler på DA/EN/NL
- `previous-years.html` — photos & videos from 2023 and 2024
- `learning-objectives.html` — learning objectives (EN/DA toggle)
- `2026.html` — year-specific info for the 2026 exchange
- `media/2023/` and `media/2024/` — drop files here, update HTML placeholders
- `qa.html` / `pakkeliste.html` — Danish pages for DK students

## Lokal uden Docker

Åbn `index.html` i browseren, eller:

```bash
npx serve .
```

## Docker (Dokploy)

```bash
# Produktion / Dokploy
docker compose up -d --build

# Lokal på http://localhost:8080
docker compose -f docker-compose.local.yml up --build
```

### Routing (Mercantec)

1. Cloudflare: `*.mercantec.tech` (wildcard CNAME → tunnel)
2. Tunnel ingress: `*.mercantec.tech` → `http://localhost:80`
3. Traefik (Dokploy): `Host(\`nl.mercantec.tech\`)` → container port 80

Sæt evt. `FRONTEND_DOMAIN` i miljøet (se `.env.example`). Router-navn: `mercantec-nl`.

### Beskyttede billetter

`ticket-api/` er en intern .NET-tjeneste. Nginx proxyer kun `/api/tickets/*` til
`ticket-api:8080` på det private Compose-netværk. API'en har ingen offentlig port
og er ikke tilsluttet `dokploy-network`.

Sæt `TICKETS_ACCESS_CODE`, `TICKETS_ADMIN_TOKEN`, `TICKETS_SESSION_SECRET` og
`TICKETS_PUBLIC_ORIGIN` i Dokploy eller en lokal, ignoreret `.env`. Koden er fælles
for holdet og valideres på serveren; adgang gemmes i en tidsbegrænset, HttpOnly-cookie.
Billetfilerne ligger i den vedvarende `ticket-data`-volume og må aldrig lægges i
Git eller webroden. Kvitteringer indgår ikke i billetkataloget.

Billetter importeres samlet via `POST /api/tickets/admin/import` med en separat
Bearer-administrationsnøgle og `Content-Type: application/zip`. ZIP-filen skal
indeholde `manifest.json` og de 10 PDF'er med filnavne i roden. Manifestet har
formen `{ "tickets": [...] }`; hver post indeholder `filename`, `title` og
`description` (begge med `da`, `en`, `nl`), `direction` (`outbound`, `return` eller
`roundtrip`), `kind` (`ticket` eller `reservation`), `passengers` og `sha256`.
Importen kontrollerer filnavne, PDF-signaturer og hashes, før kataloget aktiveres.

Brug HTTPS også ved test af kodeadgangen, da adgangscookien altid er `Secure`.
Rejseplanen og resten af siden er fortsat offentlige.
