import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recutLayout } from './recut-plan.js';
test('replacement rows allow both edge trims and apply the drop allowance once per row', () => {
  const rules = { edgeTrimMm: 10.001, dropAllowanceMm: 25.004 };
  const blind = { widthMm: 500.002, lengthMm: 1000.001, quantity: 5 };
  assert.deepEqual(recutLayout(1020.006, blind, rules), {
    across: 2,
    rows: 3,
    length: 3075015n,
  });
  assert.deepEqual(recutLayout(1020.005, blind, rules), {
    across: 1,
    rows: 5,
    length: 5125025n,
  });
  assert.equal(recutLayout(520.003, blind, rules), null);
});
