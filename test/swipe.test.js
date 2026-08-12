import assert from 'node:assert/strict';
import test from 'node:test';
import { SWIPE_ACTION_WIDTH, clampSwipeOffset, swipeSettlesOpen } from '../src/swipe.js';

test('swipe bounds and release threshold', () => {
  assert.equal(clampSwipeOffset(-999), -SWIPE_ACTION_WIDTH);
  assert.equal(clampSwipeOffset(999), 0);
  assert.equal(swipeSettlesOpen(-42), true);
  assert.equal(swipeSettlesOpen(-41), false);
});
