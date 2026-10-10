import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bucketConsumption, energyColumn, parseCurveRow, voltageColumn } from '../src/geni/parse.js';

test('parses headline/data with comma separators', () => {
  const r = parseCurveRow({
    currentDate: '2026-09-21T16:00:00Z',
    headline: 'Voltage(V),Current(A),Total Active Energy(kWh)',
    data: '230.1,4.2,1234.5',
  });
  assert.equal(r.values['Voltage(V)'], 230.1);
  assert.equal(energyColumn(r.values), 'Total Active Energy(kWh)');
  assert.equal(voltageColumn(r.values), 'Voltage(V)');
});

test('parses key=value and JSON data shapes', () => {
  assert.equal(parseCurveRow({ currentDate: '2026-01-01', data: 'kWh=12.5;V=229' }).values.kWh, 12.5);
  assert.deepEqual(parseCurveRow({ currentDate: '2026-01-01', headline: '["a","b"]', data: '[1,2]' }).values, { a: 1, b: 2 });
});

test('cumulative readings become per-bucket deltas; resets are ignored', () => {
  const at = (h) => new Date(Date.UTC(2026, 0, 1, h));
  const readings = [
    { at: at(0), kwh: 100 },
    { at: at(1), kwh: 101.5 },
    { at: at(2), kwh: 103 },
    { at: at(3), kwh: 2 }, // register reset
    { at: at(4), kwh: 3 },
  ];
  const totals = bucketConsumption(readings, (t) => t.getUTCHours());
  assert.equal(totals.get(1), 1.5);
  assert.equal(totals.get(2), 1.5);
  assert.equal(totals.get(3), undefined);
  assert.equal(totals.get(4), 1);
});

test('interval mode sums readings directly', () => {
  const t = new Date(Date.UTC(2026, 0, 1));
  const totals = bucketConsumption([{ at: t, kwh: 2 }, { at: t, kwh: 3 }], () => 'x', 'interval');
  assert.equal(totals.get('x'), 5);
});
