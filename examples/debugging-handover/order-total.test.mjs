import assert from 'node:assert/strict';
import test from 'node:test';
import { orderTotal } from './order-total.mjs';

test('empty order totals zero', () => {
  assert.equal(orderTotal([]), 0);
});

test('accepts numeric values', () => {
  assert.equal(orderTotal([{ price: 12.5, quantity: 2 }]), 25);
});

test('accepts decimal price strings from the API', () => {
  assert.equal(orderTotal([{ price: '12.50', quantity: 2 }]), 25);
});

test('rejects display-formatted prices instead of returning NaN', () => {
  assert.throws(
    () => orderTotal([{ price: '1,200.00', quantity: 1 }]),
    /invalid price/i,
  );
});
