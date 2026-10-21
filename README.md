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

Error responses use `{"ok":false,"error":"...","code":"..."}` with codes
`invalid_email` (422), `rate_limited` (429), `bad_request` (400),
`not_found` (404).

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

- The form posts to `/api/waitlist` and shows a success state only after the
  server confirms the write. Network or validation failures keep the form
  visible and show a message.
- The recovery-report figure in the hero is the real output of the demo engine
  in `D:\dunwell` (`python -m dunwell --as-of 2026-10-16`).
- Deploying: put this behind any static host plus a small serverless function
  for `POST /api/waitlist`, or run `server.py` as-is on a small VM.
