# Verbbe server ops

The stack splits **API, worker, Postgres and Redis**. Music stays on a folder you choose. Database, artwork and secrets live on paths you choose.

## Why this shape

1. **Architecture, not one binary.** A scan, a thumbnail or a login must not block each other. `server` serves HTTP. `worker` indexes, extracts artwork and watches folders. Redis holds the queue and heartbeats. Postgres holds the catalog.
2. **A real database.** Postgres on disk you pick (`DB_DATA_LOCATION`), SQL bootstrap on boot, several clients at once, dump/restore.
3. **Data where you say.** Music is a bind mount. Artwork, `secrets.json` and backups live in `DATA_LOCATION`. Postgres lives in `DB_DATA_LOCATION`. No anonymous Docker volume for the catalog.
4. **Background work.** Scan is a BullMQ job. The worker can retry. A watcher on the music folder enqueues a scan when files appear. You can still press Index in the panel.
5. **Reproducible install.** Compose pins `postgres:16-alpine`, `redis:7-alpine` and `ghcr.io/bg-isma/verbbe:1.0.0` (`VERBBE_VERSION`). Do not run production on floating `:latest`.
6. **Network.** Default is LAN only. `--mode funnel` is public HTTPS at `https://verbbe.…ts.net` and needs a one-time `SETUP_TOKEN` before the first admin can register.
7. **Product auth.** Email/password, JWT + refresh, API keys (`vbk_…`), optional OIDC, per-library members, playlist sharing. One household catalog unless you assign members.
8. **Observability.** `GET /api/health` reports postgres / redis / worker. `GET /api/admin/jobs` shows scan state. Logs are per container (`verbbe logs`).
9. **Upgrade and recover.** `verbbe backup` dumps Postgres plus artwork and secrets. `verbbe restore FILE.tgz` puts them back. Pin `VERBBE_VERSION` and run `verbbe start` to upgrade.

## Stack

| Service | Image | Role |
|---|---|---|
| `postgres` | `postgres:16-alpine` | Catalog, users, playlists |
| `redis` | `redis:7-alpine` | Scan queue + worker heartbeat |
| `server` | `ghcr.io/bg-isma/verbbe:1.0.0` | HTTP API + admin UI + stream |
| `worker` | same image | Scan, artwork extract, folder watcher |

## Paths

Set in `~/.verbbe/env` or flags on `verbbe start`:

```
MUSIC_LOCATION=/Users/you/Music
DATA_LOCATION=/Volumes/SSD/verbbe/data      # artwork, secrets, backups
DB_DATA_LOCATION=/Volumes/SSD/verbbe/postgres
VERBBE_VERSION=1.0.0
```

CLI flags: `--music`, `--data`, `--db-data`.

## Network

| Mode | What it does |
|---|---|
| `lan` (default) | Only LAN HTTP. Nothing published to the internet. |
| `funnel` | Tailscale **Funnel** — public HTTPS at `https://verbbe.…ts.net`. Register is blocked unless you pass the one-time setup token printed by the CLI. Funnel is refused until that token exists. |

## Auth

- First admin: `POST /api/auth/register`. If `SETUP_TOKEN` is set (Funnel), the body or header `x-verbbe-setup-token` must match.
- Login: email/password → access JWT (15 min) + refresh (30 days, rotation).
- API keys: `POST /api/auth/api-keys` returns `vbk_…` once. Send as `Authorization: Bearer`.
- OIDC: set `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URL`.
- Libraries: admins see all. If a user has membership rows, only those libraries. If none, household (all libraries).
- Playlists: `POST /api/library/playlists/:id/share` with `{ "userId": "…" }`.

## Backup / restore

```
verbbe backup                 # pg_dump + artwork + secrets → DATA_LOCATION/backups
verbbe restore FILE.tgz       # stops stack, restores, starts
```

## Upgrade

Pin `VERBBE_VERSION` in env, then `verbbe start`. Do not use floating `:latest` in production.

## From a previous SQLite install

This stack does **not** auto-migrate `verbbe.sqlite`. Export playlists from the app if you care, then `verbbe start` on the new compose (empty Postgres). Re-scan the same music folder; artwork is rebuilt. Keep a copy of the old `~/.verbbe` tree until you are happy.

## Health

`GET /api/health` returns 200 only when Postgres, Redis and the worker heartbeat (20s) are up. The panel shows the same status plus scan jobs.
