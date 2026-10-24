/**
 * Local harness for the GitHub Pages Function proxy.
 *
 * Runs the real function module against a real Dunwell service, with a mock
 * Pages context. This is the same code that ships to GitHub Pages, so a pass
 * here means the proxy logic is correct before it is ever deployed.
 *
 *   node proxy-test.mjs
 */
import { onRequestPost, onRequestGet as onRequestGetSignup } from "./functions/api/waitlist.js";
import { onRequestGet } from "./functions/api/waitlist/count.js";

const SERVICE = process.env.DUNWELL_API_URL || "http://127.0.0.1:8910";

function ctx(body, env = { DUNWELL_API_URL: SERVICE }) {
  return {
    env,
    request: new Request("https://example.test/api/waitlist", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  };
}

let failures = 0;
function check(name, condition, detail) {
  const ok = Boolean(condition);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? " -> " + detail : ""}`);
}

console.log(`Service under test: ${SERVICE}\n`);

console.log("count endpoint");
{
  const res = await onRequestGet(ctx(""));
  const body = await res.json();
  check("returns 200", res.status === 200, `status=${res.status}`);
  check("returns ok:true and a count", body.ok === true && typeof body.count === "number", JSON.stringify(body));
}

console.log("\nsignup endpoint");
{
  const res = await onRequestPost(ctx({ email: "Proxy@Test.example", source: "landing" }));
  const body = await res.json();
  check("returns 200", res.status === 200, `status=${res.status}`);
  check("returns ok:true", body.ok === true, JSON.stringify(body));
  check("count is a number", typeof body.count === "number", JSON.stringify(body));
}

console.log("\nduplicate signup");
{
  const res = await onRequestPost(ctx({ email: "proxy@test.example", source: "landing" }));
  const body = await res.json();
  check("returns 200", res.status === 200, `status=${res.status}`);
  check("is flagged as already", body.already === true, JSON.stringify(body));
}

console.log("\ninvalid email is rejected locally (no wasted round trip)");
{
  const res = await onRequestPost(ctx({ email: "not-an-email" }));
  const body = await res.json();
  check("returns 422", res.status === 422, `status=${res.status}`);
  check("code is invalid_email", body.error && body.error.code === "invalid_email", JSON.stringify(body));
}

console.log("\nmalformed body");
{
  const res = await onRequestPost(ctx("{not json"));
  const body = await res.json();
  check("returns 400", res.status === 400, `status=${res.status}`);
  check("code is bad_request", body.error && body.error.code === "bad_request", JSON.stringify(body));
}

console.log("\nunconfigured service URL fails loudly, not silently");
{
  const res = await onRequestPost(ctx({ email: "x@y.test" }, {}));
  const body = await res.json();
  check("returns 503", res.status === 503, `status=${res.status}`);
  check("code is waitlist_not_configured", body.error && body.error.code === "waitlist_not_configured", JSON.stringify(body));
}

console.log("\nGET is not allowed on the signup route");
{
  // The signup module's own GET handler must refuse the method.
  const res = await onRequestGetSignup(ctx(""));
  check("returns 405", res.status === 405, `status=${res.status}`);
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exitCode = failures === 0 ? 0 : 1;
