// Deployment settings for the static page.
//
// Committed with empty values so local development stays same-origin
// (server.py serves the page and the API from one place). The GitHub Pages
// workflow rewrites this file at deploy time from repository variables:
//
//   Settings > Secrets and variables > Actions > Variables
//
//   DUNWELL_API_URL   the Dunwell service origin, e.g. https://app.dunwell.app
//   DUNWELL_DEMO_URL  a YouTube/Vimeo link, or a direct .mp4
//
// Empty values are safe:
//   - no API URL  -> the form falls back to same-origin
//   - no demo URL -> the "watch the demo" button stays hidden
window.DUNWELL_API_URL = "";
window.DUNWELL_DEMO_URL = "";
