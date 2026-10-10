// API origin for the admin dashboard. Empty = same origin (when the API serves
// /admin itself). Set to e.g. "https://api.smeter.ng" when hosted separately.
window.SMETER_API = window.SMETER_API ?? (location.port === '5501' ? 'http://localhost:8080' : '');
// Public website URL, used for "View on site" links.
window.SMETER_SITE = window.SMETER_SITE ?? (window.SMETER_API || location.origin);
