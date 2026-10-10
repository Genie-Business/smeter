// Where the website loads its editable content from, and posts leads to.
// Set this to the deployed API origin. When the site is served by the API
// itself (SITE_DIR), leave it empty to use the same origin.
window.SMETER_API = window.SMETER_API ?? (location.port === '5500' || location.protocol === 'file:' ? 'http://localhost:8080' : '');
