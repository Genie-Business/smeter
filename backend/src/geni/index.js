import { config } from '../config.js';
import { GeniClient } from './client.js';
import { MockGeniClient } from './mock.js';

let client;

export function geni() {
  client ??= config.geni.mode === 'live' ? new GeniClient() : new MockGeniClient();
  return client;
}

export function setGeni(next) {
  client = next;
}
