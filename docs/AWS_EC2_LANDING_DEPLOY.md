# AWS EC2 Landing Deployment

This setup mirrors your landing deployment pattern:
- `docker-compose.landing.yml`
- Nginx reverse proxy on `80/443`
- Static nginx config at `configs/nginx/nginx.conf`

## 1) Prerequisites

- Ubuntu EC2 instance with Docker + Docker Compose plugin installed
- DNS `A` records pointing to your EC2 public IP
  - Example: `traitharvest.ai`, `www.traitharvest.ai`, `traitharvest.org`, `www.traitharvest.org`
- Security Group inbound rules open for:
  - `80/tcp`
  - `443/tcp`

## 2) Configure env

Copy and edit `.env`:

```bash
cp .env.example .env
```

Set at least:

```bash
POSTGRES_USER=nutrition
POSTGRES_PASSWORD=securepassword123
POSTGRES_DB=nutrition_ai
```

## 3) Start stack (exact command)

```bash
docker compose -f docker-compose.landing.yml up -d --build
```

TLS path used by nginx HTTPS config:

```text
/etc/letsencrypt/live/traitharvest.ai/fullchain.pem
/etc/letsencrypt/live/traitharvest.ai/privkey.pem
```

Install/renew certificates manually on EC2, then restart nginx if certs change:

```bash
docker compose -f docker-compose.landing.yml restart nginx
```

## 4) Verify

- Frontend: `https://traitharvest.ai`
- API health: `https://traitharvest.ai/health`
- API docs: `https://traitharvest.ai/docs`
- Admin: `https://traitharvest.ai/admin`
