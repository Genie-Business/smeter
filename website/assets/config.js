// API origin for the website (www.smeter.app) and the admin dashboard
// (admin.smeter.app, which loads this file too).
// - Served by the API itself (SITE_DIR, e.g. localhost:8080): same origin.
// - Any other local dev server (Live Server, file://): the local API on :8080.
// - Deployed: the hosted API. Change API_URL when it moves.
(() => {
  const API_URL = 'https://api.smeter.app';
  const local = location.protocol === 'file:' || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const sameOrigin = location.port === '8080' || location.origin === API_URL;
  window.SMETER_API = window.SMETER_API ?? (sameOrigin ? '' : local ? 'http://localhost:8080' : API_URL);
})();
