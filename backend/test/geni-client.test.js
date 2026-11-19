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
  // Head-end times are WAT (UTC+1).
  assert.deepEqual(await rows(hist).onlineStatus('473'), { online: true, lastSeen: '2026-11-17T16:08:54.000Z' });
  assert.equal((await rows([...hist].reverse()).onlineStatus('473')).online, true);
  assert.equal((await rows([]).onlineStatus('473')).online, false);
});

// A head-end stub answering by path; `handler(path, body)` returns { code, result }.
function stub(handler, sent = []) {
  return new GeniClient({ ...cfg, disconnectProtocolId: 20001, reconnectProtocolId: 20000, disconnectData: '', reconnectData: '' },
    async (url, init) => {
      const path = new URL(url).pathname;
      const body = JSON.parse(init.body);
      if (path === '/API/User/Login') return new Response(JSON.stringify({ code: 0, result: { token: 'x' } }));
      sent.push({ path, body });
      return new Response(JSON.stringify(handler(path, body)));
    });
}

test('Switch Off / Switch On are sent the way the head-end console sends them', async () => {
  const sent = [];
  const c = stub(() => ({ code: 0, result: [{ id: 501 }] }), sent);
  assert.deepEqual(await c.control({ customerId: 'C1', meterId: '473', action: 'disconnect' }), { taskId: '501' });
  await c.control({ customerId: 'C1', meterId: '473', action: 'reconnect' });
  assert.deepEqual(sent.map((s) => s.body[0]), [
    { company: 'Geni', customerId: 'C1', meterId: '473', protocolId: 20001 },
    { company: 'Geni', customerId: 'C1', meterId: '473', protocolId: 20000 },
  ]);
  assert.equal(sent[0].path, '/API/RemoteMeterTask/CreateControlTask');
});

test('task status follows the console: 0 standing by, 1 success, 2 failure', async () => {
  const statuses = { 1: 0, 2: 1, 3: 2 };
  const c = stub((path, body) => ({ code: 0, result: { data: statuses[body.id] === undefined ? [] : [{ id: body.id, status: statuses[body.id] }] } }));
  assert.equal((await c.taskStatus('control', 1)).status, 'pending');
  assert.equal((await c.taskStatus('control', 2)).status, 'success');
  assert.equal((await c.taskStatus('token', 3)).status, 'failed');
  assert.equal(await c.taskStatus('control', 4), null);
});

test('a corrupt stored reading only drops its own hour, not the whole range', async () => {
  const bad = Date.parse('2026-11-17T12:30:00Z');
  const rows = [Date.parse('2026-11-17T06:00:00Z'), Date.parse('2026-11-17T20:00:00Z')];
  const c = stub((path, body) => {
    const [from, to] = body.createDateRange.map(Date.parse);
    if (bad >= from && bad < to) return { code: 99, reason: 'Additional non-parsable characters are at the end of the string.' };
    const data = rows.filter((t) => t >= from && t < to).map((t) => ({ currentDate: new Date(t).toISOString(), headline: 'kWh', data: '1' }));
    return { code: 0, result: { total: data.length, data } };
  });
  const got = await c.loadProfile({ meterId: '473', isThreePhase: 1, from: new Date('2026-11-17T00:00:00Z'), to: new Date('2026-11-18T00:00:00Z') });
  assert.deepEqual(got.map((r) => r.currentDate), ['2026-11-17T06:00:00.000Z', '2026-11-17T20:00:00.000Z']);
});

test('other head-end errors still fail the query', async () => {
  const c = stub(() => ({ code: 5, reason: 'denied' }));
  await assert.rejects(c.loadProfile({ meterId: '473', from: new Date(0), to: new Date(864e5) }), /denied/);
});
