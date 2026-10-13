# Minority Rule — online multiplayer

Server-authoritative YES/NO minority-vote game. N players → N rounds → one question each, fixed stakes, no eliminations.

## Layout

- `src/` — React client (manga B/W + red UI). Menu → **Online match** (server) or **Practice vs bots** (offline).
- `server/` — Node + TypeScript authoritative server (Socket.IO, Zod, SQLite via `node:sqlite`).

## Run locally

Terminal 1 — server:

```sh
cd server
cp .env.example .env   # set SESSION_SECRET, ALLOWED_ORIGINS
npm install
npm run build && npm start   # :8081
```

Terminal 2 — client:

```sh
cp .env.example .env   # VITE_SERVER_URL=http://localhost:8081
npm install
npm run dev            # :8080
```

Open two browsers at `http://localhost:8080` → Online match → one creates a room, the other joins with the code.

## Rules (defaults)

3–12 players (target 6, bots fill seats) · 100-chip start · 10-chip fixed stake ·
N rounds = locked roster size · one locked question each, server-shuffled (crypto RNG) ·
simultaneous secret votes · minority splits the pot · ties refund · no eliminations ·
missing vote = abstain (stake forfeited) · missing question = neutral fallback.

Deadlines are server-controlled; countdowns are display-only. Rounds lock early when
everyone has voted; results advance on READY_NEXT or after 8s.

## Tests

```sh
cd server
npm test        # 29 unit/integration tests (rules, economy, multiplayer, security)
npm run test:e2e  # real-socket 3-client full match + attack rejections
```

## Deploy (no PC-as-server)

Your PC stays off. Two routes:

**A. Render free tier (easiest, sleeps when idle)**
1. Push this folder to a GitHub repo.
2. Render → New → Blueprint → select repo (`render.yaml` wires both services).
3. Open `https://minority-client.onrender.com` on any devices and play.
   First join after idle takes ~30s (free-tier wake). DB is ephemeral here.

**B. Oracle Cloud free VPS (always-on, persistent)**
1. Create a free Ampere VM (Ubuntu 24.04), open TCP 8081 + 80/443.
2. Install Docker, copy `server/` over, then:
   ```sh
   docker build -t minority-server ./server
   docker run -d --restart always --name minority -p 8081:8081 \
     -e SESSION_SECRET='long-random-string' \
     -e ALLOWED_ORIGINS='https://your-client-url' \
     -v minority-data:/data minority-server
   ```
3. Deploy the client anywhere static (Vercel/Netlify/Render) with
   `VITE_SERVER_URL=http://your-vps-ip:8081` (or put Caddy/Nginx + TLS in front
   and use `https://`). Docker data persists in the `minority-data` volume.

TLS note: browsers on `https://` pages refuse `ws://` (insecure) sockets, so the
server URL must be `https://`/`wss://` in production — both routes above support that.

## Production notes

- Set `SESSION_SECRET`, `ALLOWED_ORIGINS`, `DATABASE_PATH` (persistent volume).
- Serve behind TLS; Socket.IO CORS is locked to `ALLOWED_ORIGINS`.
- SQLite (WAL) fits single-node play. For multi-node, port `server/src/store.ts`
  to Postgres (all queries are parameterized) and add a shared pub/sub for emits.
- Restart recovery policy: non-terminal matches are cancelled with open stakes
  refunded (see `Engine.recover`); ledger preserves all history.
- Moderation: `REPORT_CONTENT` stores reports in `reports` table for human review.
  With `ADMIN_TOKEN` set, use `ADMIN_AUTH` then `ADMIN_REPORTS` / `ADMIN_DISMISS` /
  `ADMIN_BLOCK` (blocklisted text is rejected at future submissions).
- Accounts: `REGISTER` / `LOGIN` (scrypt-hashed passwords, 5/min/IP limit),
  `MY_PROFILE` returns persistent stats (matches, wins, minority wins, net chips,
  best rank). Guests play fully but accrue no stats.

## Abuse & DDoS posture

In-app (this repo): per-socket + per-IP rate limits (rooms 10/hr/IP, votes 5/10s,
auth 5/min/IP, chat 100/min), 5 conns/IP, 500 global conns with clean shed
(`server-full`), 200 live rooms cap, 100KB message cap, ping/connect timeouts,
correct client IP behind proxies (`TRUST_PROXY=1` + Cloudflare headers).

Volumetric attacks need the edge, not app code. Recommended free setup:
1. Add your domain (or the onrender host) to a free Cloudflare plan (proxy ON).
2. Cloudflare absorbs L3/L4/L7 floods + free WAF/rate-rules; keep ours as
   defense-in-depth. Socket.IO heartbeats (25s) fit Cloudflare's 100s idle timeout.
3. On Render free tier, one instance can still be saturated by a big pipe —
   Oracle VPS + Cloudflare is the sturdier free combo. Never promise players
   immunity to collusion or large botnets; we detect and shed, not prevent.
