import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectRecurringExpenses } from '../src/services/recurring.js';

const row = (date, amount = 12.99, merchant = 'Example Stream') => ({
  merchant_name: merchant,
  transaction_date: date,
  currency: 'GBP',
  total_amount: amount,
});

test('detects a recent monthly expense with modest amount variation', () => {
  const expenses = detectRecurringExpenses([
    row('2026-09-01', 12.99),
    row('2026-10-01', 13.49),
    row('2026-11-01', 12.99),
  ], '2026-11-04');

  assert.equal(expenses.length, 1);
  assert.equal(expenses[0].cadence, 'monthly');
  assert.equal(expenses[0].occurrence_count, 3);
  assert.equal(expenses[0].expected_date, '2026-12-01');
});

test('does not classify fewer than three charges or stale patterns as recurring', () => {
  assert.deepEqual(detectRecurringExpenses([
    row('2026-10-01'),
    row('2026-11-01'),
  ], '2026-11-04'), []);

  assert.deepEqual(detectRecurringExpenses([
    row('2026-06-01'),
    row('2026-07-01'),
    row('2026-08-01'),
  ], '2026-11-04'), []);
});
