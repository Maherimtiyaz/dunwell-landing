/**
 * GitHub Pages Function: waitlist count.
 *
 * Mirrors the service's GET /api/waitlist/count so the landing page reads
 * the same number the service holds. No emails are exposed - only a total.
 *
 * See ../waitlist.js for the DUNWELL_API_URL configuration.
 */

const TIMEOUT_MS = 8000;

export async function onRequestGet(context) {
  const base = serviceUrl(context.env);
  if (!base) {
    return json(503, {
      ok: false,
      error: {
        message: "The waitlist is not connected yet.",
        code: "waitlist_not_configured",
      },
    });
  }

  try {
    const upstream = await fetch(`${base}/api/waitlist/count`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await upstream.text();
    return new Response(text || JSON.stringify({ ok: true, count: 0 }), {
      status: upstream.status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch {
    return json(503, {
      ok: false,
      error: {
        message: "Could not reach the waitlist.",
        code: "waitlist_unreachable",
      },
    });
  }
}

function serviceUrl(env) {
  const raw = String((env && env.DUNWELL_API_URL) || "").trim();
  if (!raw) return "";
  return raw.replace(/\/+$/, "");
}

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
