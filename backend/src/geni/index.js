// The head-end client in use. Connection details come from the admin dashboard
// (Settings → Meter head-end), falling back to the GENI_* env vars; the client
// is rebuilt whenever they change. refreshGeni() is awaited on every API
// request (cached), so geni() itself stays synchronous.
import { config } from '../config.js';
import { getGeniSettings } from '../services/settings.js';
import { GeniClient } from './client.js';
import { MockGeniClient } from './mock.js';

let effective = null; // last loaded settings
let client = null;
let clientKey = '';
let pinned = null; // tests
const mock = new MockGeniClient();

export async function refreshGeni() {
  effective = await getGeniSettings();
  return effective;
}

function current() {
  return effective ?? {
    mode: config.geni.mode,
    baseUrl: config.geni.baseUrl,
    company: config.geni.company,
    userId: config.geni.userId,
    password: config.geni.password,
    authorizationPassword: config.geni.authorizationPassword,
  };
}

/** 'live' | 'mock' for the settings in use. */
export function geniMode() {
  return pinned ? (pinned instanceof MockGeniClient ? 'mock' : 'live') : current().mode;
}

export function geni() {
  if (pinned) return pinned;
  const s = current();
  if (s.mode !== 'live') return mock;
  const key = JSON.stringify([s.baseUrl, s.company, s.userId, s.password, s.authorizationPassword]);
  if (key !== clientKey) {
    client = new GeniClient({
      ...config.geni,
      mode: 'live',
      baseUrl: s.baseUrl,
      company: s.company,
      userId: s.userId,
      password: s.password,
      authorizationPassword: s.authorizationPassword,
    });
    clientKey = key;
  }
  return client;
}

export function setGeni(next) {
  pinned = next;
}
