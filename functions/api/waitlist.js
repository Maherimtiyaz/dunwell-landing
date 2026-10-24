/**
 * GitHub Pages Function: waitlist sign-up.
 *
 * The browser posts to /api/waitlist on whatever host serves this page.
 * This function forwards the sign-up to the deployed Dunwell service, so
 * the waitlist lives in the service's SQLite database instead of a store
 * that dies with the static site.
 *
 * Why a proxy instead of the browser posting to the service directly:
 * the landing and the service usually live on different hosts, and a
 * cross-origin POST is blocked by the browser. Proxying keeps the request
 * same-origin for the visitor and needs no CORS configuration.
 *
 * Configuration:
 *   Set the environment variable DUNWELL_API_URL to the service's base URL,
 *   e.g. https://app.dunwell.app  (repo Settings > Environments > github-pages
 *   > Variables). Without it the form returns a clear 503 rather than
 *   silently dropping sign-ups.
 *
 * The service is authoritative for the waitlist, so this function does no
 * storage of its own.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_BODY = 16 * 1024;
const TIMEOUT_MS = 8000;

export async function onRequestPost(context) {
  const base = serviceUrl(context.env);
  if (!base) {
    return json(
      503,
      {
        ok: false,
        error: {
          message: "The waitlist is not connected yet. Please try again later.",
          code: "waitlist_not_configured",
        },
      },
    );
  }

  const raw = await context.request.text();
  if (!raw || raw.length > MAX_BODY) {
    return json(400, badRequest("Bad request"));
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json(400, badRequest("Bad request"));
  }
  if (!payload || typeof payload !== "object") {
    return json(400, badRequest("Bad request"));
  }

  // Validate here so a typo does not spend a round trip to the service.
  const email = String(payload.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return json(422, {
      ok: false,
      error: {
        message: "Please enter a valid email address.",
        code: "invalid_email",
      },
    });
  }
  const source = String(payload.source || "landing").trim().slice(0, 64) || "landing";

  try {
    const upstream = await fetch(`${base}/api/waitlist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, source }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const text = await upstream.text();
    // Pass the service's answer through unchanged: it owns the contract.
    return new Response(text || JSON.stringify(badRequest("Bad request")), {
      status: upstream.status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch {
    return json(503, {
      ok: false,
      error: {
        message: "Could not reach the waitlist. Please try again in a minute.",
        code: "waitlist_unreachable",
      },
    });
  }
}

export async function onRequestGet() {
  return json(405, {
    ok: false,
    error: { message: "Method not allowed", code: "method_not_allowed" },
  });
}

function serviceUrl(env) {
  const raw = String((env && env.DUNWELL_API_URL) || "").trim();
  if (!raw) return "";
  // Normalise: drop a trailing slash so path joining stays predictable.
  return raw.replace(/\/+$/, "");
}

function badRequest(message) {
  return { ok: false, error: { message, code: "bad_request" } };
}

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
