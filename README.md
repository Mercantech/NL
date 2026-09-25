# TerAA × Mercantec Colab

Info- og programsite for Helmond–Viborg-udvekslingen. Live: **https://nl.mercantec.tech**

## Sider

- `index.html` — program, steder, praktisk info, kontakt
- `qa.html` — Q&A til danske elever (dansk)
- `pakkeliste.html` — pakke-checkliste til danske elever
- `previous-years.html` — photos & videos from 2023 and 2024
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
