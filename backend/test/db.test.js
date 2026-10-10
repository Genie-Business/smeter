import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toPg } from '../src/db.js';

test('toPg numbers placeholders and leaves quoted ? alone', () => {
  assert.equal(toPg('SELECT * FROM t WHERE a = ? AND b = ?'), 'SELECT * FROM t WHERE a = $1 AND b = $2');
  assert.equal(toPg("SELECT '?' AS q, \"we?ird\" FROM t WHERE a = ?"), "SELECT '?' AS q, \"we?ird\" FROM t WHERE a = $1");
});
