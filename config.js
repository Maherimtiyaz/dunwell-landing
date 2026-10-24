// Where the waitlist API lives.
//
// Committed empty so local development stays same-origin (server.py serves
// the form and the API from one place). The GitHub Pages workflow rewrites
// this file at deploy time from the DUNWELL_API_URL repository variable, e.g.
//
//   window.DUNWELL_API_URL = "https://app.dunwell.app";
//
// Leave it empty when the landing and the API share an origin.
window.DUNWELL_API_URL = "";
