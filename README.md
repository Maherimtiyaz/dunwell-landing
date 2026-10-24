# Dunwell landing

Single-page marketing site for **Dunwell** — the AI receivables agent for
startups, agencies, and small B2B service businesses.

The page has one job: convert visitors into early-access signups.

## Run it

```powershell
cd D:\dunwell-landing
python server.py --port 8905
```

Then open http://127.0.0.1:8905

`server.py` is standard-library only (no dependencies, no install step). It:

- serves `index.html` and `styles.css` as static files
- accepts `POST /api/waitlist` and appends signups to `data/waitlist.csv`
- exposes `GET /api/waitlist/count` (count only — never emails)

## Endpoints

| Method | Path                   | Body                        | Response                          |
| ------ | ---------------------- | --------------------------- | --------------------------------- |
| GET    | `/`                    | –                           | landing page                      |
| GET    | `/api/waitlist/count`  | –                           | `{"ok":true,"count":N}`           |
| POST   | `/api/waitlist`        | `{"email","source"}`        | `{"ok":true,"count":N}`           |

Error responses use `{"ok":false,"error":{"message","code"},"code"}` — the
same contract as the Dunwell service, so this page works unchanged whether
it is served by `server.py` or by the service. Codes: `invalid_email` (422),
`rate_limited` (429), `bad_request` (400), `not_found` (404).

## Storage

Signups append to `data/waitlist.csv` (`email,source,ts`). That file **is** the
export — open it in Excel or `Import-Csv` it. It is never served over HTTP
(the static handler only serves allow-listed asset extensions), so customer
emails are not publicly readable.

## Guardrails

- **Path safety:** only files directly under this directory with a known asset
  extension are served; `server.py`, `data/` and any dotfiles return 404.
- **Rate limit:** 10 requests per IP per 60 seconds on the waitlist endpoint.
- **Dedupe:** emails are matched case-insensitively; repeat signups return
  `already: true` without writing a second row.
- **Validation:** email format checked client-side and server-side.

## Notes

- The form resolves its endpoint against the page URL, so it works from a
  domain root, from a GitHub project subpath (`/dunwell-landing/`), and from
  the local server. It falls back to `/api/waitlist` only if the resolved path
  answers 404.
- The recovery-report figure in the hero is the real output of the demo engine
  in `D:\dunwell` (`python -m dunwell --as-of 2026-10-16`).

---

# Distribution

There are two supported ways to publish this page, and they differ in **where
the waitlist is stored**. Pick one and make it authoritative — do not run both
against different stores, or your signups split in half.

## Option 1 — GitHub Pages (recommended)

The static site is served by GitHub Pages: free, global CDN, TLS included, and
it cannot be slowed down by a slow query on the service. The waitlist is
forwarded to the deployed **Dunwell service**, so there is one authoritative
store (the service's SQLite database) and nothing is lost when a static site
is redeployed.

### How it works

```
visitor ──POST /api/waitlist──▶ GitHub Pages
                                    │
                                    │ Pages Function (server-side)
                                    ▼
                              Dunwell service ──▶ SQLite waitlist table
```

The browser only ever talks to its own host, so there is no CORS problem and
no third-party cookie blocking. The Pages Function is a thin proxy; the
service owns validation, dedupe, rate limiting, and storage.

### Setup

1. **Deploy the service first** and note its URL, e.g.
   `https://app.dunwell.app`. See the service repo's `deploy.md`.

2. **Enable Pages on this repo.** The `pages.yml` workflow deploys on every
   push to `main`. Set **Settings → Pages → Source → GitHub Actions**. The
   first push publishes the site at
   `https://maherimtiyaz.github.io/dunwell-landing/`.

3. **Point the function at the service.** Add an environment variable:

   | Where | Name | Value |
   | --- | --- | --- |
   | Repo → Settings → Environments → `github-pages` → Variables | `DUNWELL_API_URL` | `https://app.dunwell.app` |

   The value is a public URL, so a repository *variable* is enough — no
   secret needed.

4. **Verify.** Submit the form on the live site. The signup appears in the
   service's `waitlist` table, and `GET /api/waitlist/count` on the service
   returns the same number the landing shows.

### Notes

- The publish step stages an explicit whitelist of files
  (`index.html`, `styles.css`, `privacy.html`, `terms.html`). `server.py` and
  `data/waitlist.csv` are **never** published, and the workflow fails loudly
  if they ever appear in the artifact.
- Without `DUNWELL_API_URL` the form returns `503 waitlist_not_configured`
  and shows a retry message — sign-ups are never silently dropped.
- The function times out after 8 seconds. If your service sleeps on a free
  tier, the first request after an idle period can be slow; keep the service
  warm or move it to a platform with a persistent volume.
- To use a custom domain, add a `CNAME` file with your domain and point a
  CNAME at `maherimtiyaz.github.io`; GitHub provisions TLS for you.

## Option 2 — standalone `server.py`

Run this repo's own server and publish it as a single web service:

```bash
python server.py --host 0.0.0.0 --port $PORT
```

Static files and the waitlist come from the same origin, so there is no
proxy, no function, and no service dependency. The tradeoff: the waitlist
lives in `data/waitlist.csv` on that machine's disk, so **the platform must
have a persistent filesystem**. On Render or Koyeb's free tier the disk is
ephemeral and sign-ups vanish on every restart — a landing page that silently
loses leads is worse than one with a proxy.

Use this option when you want the landing fully independent of the service.

## Which one?

| | Option 1: Pages + service | Option 2: standalone server |
| --- | --- | --- |
| Static hosting | GitHub Pages (CDN, free) | the app server |
| Waitlist store | the service's SQLite | `data/waitlist.csv` |
| Needs the service | yes | no |
| Needs a persistent disk | the service's | this server's |
| Cold start | service may sleep | server may sleep |

Option 1 is the better default: one place for the data, one backup, and the
marketing site is insulated from the app's uptime.
