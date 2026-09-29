import assert from 'node:assert/strict';
import test from 'node:test';
import { analyticsPath } from '../src/lib/analytics.ts';

test('GA4 paths hide member addresses and resource identifiers', () => {
  assert.equal(analyticsPath('/members/mike%40example.com'), '/members/profile');
  assert.equal(analyticsPath('/gigs/1234'), '/gigs/detail');
  assert.equal(analyticsPath('/view/private-score-hash'), '/view/item');
  assert.equal(analyticsPath('/library-status/parts/private-score-hash'), '/library-status/parts/detail');
  assert.equal(analyticsPath('/members'), '/members');
  assert.equal(analyticsPath('/unexpected/private-path'), '/other');
});
