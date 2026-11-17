import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GeniClient } from '../src/geni/client.js';

const cfg = { baseUrl: 'http://head-end', company: 'Geni', userId: 'u', password: 'p', authorizationPassword: 'a', successCodes: [0], timeoutMs: 1000 };

function client(generate, records, calls = []) {
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname;
    calls.push(path);
    const result = path === '/API/User/Login' ? { token: 'x' }
      : path === '/API/Token/CreditToken/Generate' ? generate
      : path === '/API/Token/CreditTokenRecord/Read' ? (records instanceof Error ? null : { data: records })
      : null;
    if (records instanceof Error && path.endsWith('Read')) return new Response('nope', { status: 500 });
    return new Response(JSON.stringify({ code: 0, result }), { status: 200 });
  };
  return new GeniClient(cfg, fetchImpl);
}

const vend = (c) => c.vendCredit({ meterId: '473', amountNaira: 1000, serialNumber: 'ref' });

test('receiptId 0 from Generate is replaced by the record for that meter + token', async () => {
  const records = [
    { receiptId: 143, meterId: '473', token: '1111 2222 3333 4444 5555' },
    { receiptId: 144, meterId: '473', token: '4517 8517 4593 6816 6960' },
    { receiptId: 150, meterId: '999', token: '4517 8517 4593 6816 6960' },
  ];
  const v = await vend(client({ receiptId: 0, token: '45178517459368166960', totalUnit: 4.8 }, records));
  assert.equal(v.receiptId, '144');
});

test('a real receiptId is kept without an extra lookup', async () => {
  const calls = [];
  const v = await vend(client({ receiptId: 77, token: '12345678901234567890' }, [], calls));
  assert.equal(v.receiptId, '77');
  assert.ok(!calls.includes('/API/Token/CreditTokenRecord/Read'));
});

test('a failed or empty record lookup does not fail the vend', async () => {
  const none = await vend(client({ receiptId: 0, token: '12345678901234567890' }, []));
  assert.equal(none.token, '12345678901234567890');
  assert.equal(none.receiptId, '0');
  const broken = await vend(client({ receiptId: 0, token: '12345678901234567890' }, new Error('x')));
  assert.equal(broken.token, '12345678901234567890');
});

test('onlineStatus uses the latest history row whatever the order', async () => {
  const rows = (list) => new GeniClient(cfg, async (url) => {
    const result = new URL(url).pathname === '/API/User/Login' ? { token: 'x' } : list;
    return new Response(JSON.stringify({ code: 0, result }), { status: 200 });
  });
  const hist = [
    { meterId: '473', isOnline: false, statusUpdateDate: '2026-11-17 12:36:20' },
    { meterId: '473', isOnline: true, statusUpdateDate: '2026-11-17 17:08:54' },
    { meterId: '999', isOnline: false, statusUpdateDate: '2026-11-17 18:00:00' },
    { meterId: '473', isOnline: false, statusUpdateDate: '2026-10-13 13:46:31' },
  ];
  assert.deepEqual(await rows(hist).onlineStatus('473'), { online: true, lastSeen: '2026-11-17 17:08:54' });
  assert.equal((await rows([...hist].reverse()).onlineStatus('473')).online, true);
  assert.equal((await rows([]).onlineStatus('473')).online, false);
});
