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

Error responses use `{"ok":false,"error":{"message","code"}}` — the same
contract as the Dunwell service, so this page works unchanged whether it is
served by `server.py` or by the service. Codes: `invalid_email` (422),
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

- The recovery-report figure in the hero is the real output of the demo engine
  in `D:\dunwell` (`python -m dunwell --as-of 2026-10-16`).

---

# Distribution

There are two ways to publish this page. They differ in **where the waitlist
is stored**. Pick one and make it authoritative — do not run both against
different stores, or your signups split in half.

## Option 1 — GitHub Pages, posting to the Dunwell service (live)

**GitHub Pages is a static file host.** It runs no server code — there are no
"Pages Functions" on GitHub Pages (that is a Cloudflare Pages feature). So the
form cannot be handled on Pages itself. Instead the page posts the sign-up
**directly to the deployed Dunwell service**, which already owns the waitlist
table.

```
visitor ──POST (cross-origin)──▶ Dunwell service ──▶ SQLite waitlist
   ▲
   └── index.html + styles.css on GitHub Pages (static)
```

The service is authoritative, so there is one store and one backup.

### Setup

1. **Deploy the service** and note its origin, e.g. `https://app.dunwell.app`.
   See the service repo's `deploy.md`. It needs a persistent disk for its
   SQLite file.

2. **Allow this origin on the service.** Set:

   ```
   DUNWELL_CORS_ORIGINS=https://maherimtiyaz.github.io
   ```

   Only the public waitlist routes honour CORS; the authenticated API stays
   same-origin. Use your custom domain here instead once you add one.

3. **Point the page at the service.** Add a repository **variable**
   (Settings → Secrets and variables → Actions → **Variables** tab):

   | Name | Value |
   | --- | --- |
   | `DUNWELL_API_URL` | `https://app.dunwell.app` |

   The Pages workflow writes it into `config.js` at deploy time. It is a
   public URL, so a variable is enough — no secret needed.

4. **Enable Pages.** Already done for this repo: **Settings → Pages → Source →
   GitHub Actions**. The site is at
   `https://maherimtiyaz.github.io/dunwell-landing/`.

5. **Verify.** Submit the form on the live site. The signup appears in the
   service's `waitlist` table, and the service's `/api/waitlist/count`
   reports the same number.

### Notes

- The form posts to an absolute URL when `DUNWELL_API_URL` is set, and to the
  same origin otherwise. With neither configured it says plainly that the
  waitlist is not connected — it never pretends to succeed.
- The publish step stages an explicit whitelist of files and fails the build
  if `server.py` or `data/waitlist.csv` would reach the artifact. Publishing
  the repository root would have exposed customer emails.
- A JSON POST triggers a CORS preflight, so the service must answer
  `OPTIONS /api/waitlist`. It does, for the origins in
  `DUNWELL_CORS_ORIGINS`.
- **If the service sleeps** (free tiers do), the first signup after an idle
  period can take up to a minute. The page reports a retry message rather
  than hanging.

## Option 2 — standalone `server.py`

Run this repo's own server and publish it as a single web service:

```bash
python server.py --host 0.0.0.0 --port $PORT
```

Static files and the waitlist share an origin, so there is no CORS and no
service dependency. The tradeoff: the waitlist lives in
`data/waitlist.csv` on that machine's disk, so **the platform must have a
persistent filesystem**. On Render or Koyeb's free tier the disk is ephemeral
and sign-ups vanish on every restart — a landing page that silently loses
leads is worse than one that needs the service.

Use this when you want the landing fully independent of the service.

## Which one?

| | Option 1: Pages + service | Option 2: standalone server |
| --- | --- | --- |
| Static hosting | GitHub Pages (CDN, free) | the app server |
| Waitlist store | the service's SQLite | `data/waitlist.csv` |
| Needs the service | yes | no |
| Needs CORS | yes (one env var) | no |
| Needs a persistent disk | the service's | this server's |

Option 1 is the better default: one place for the data, one backup, and the
marketing site is insulated from the app's uptime.

## What about Cloudflare Pages?

If you would rather keep the form same-origin, Cloudflare Pages — not GitHub
Pages — supports serverless functions in a `functions/` directory, which can
proxy to the service. That avoids CORS but adds a second host to manage. The
GitHub Pages setup above is simpler and already live.
