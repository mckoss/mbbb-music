import assert from 'node:assert/strict';
import test from 'node:test';
import { analyticsPath, trackAnalyticsPage } from '../src/lib/analytics.ts';

test('GA4 paths hide member addresses and resource identifiers', () => {
  assert.equal(analyticsPath('/members/mike%40example.com'), '/members/profile');
  assert.equal(analyticsPath('/gigs/1234'), '/gigs/detail');
  assert.equal(analyticsPath('/view/private-score-hash'), '/view/item');
  assert.equal(analyticsPath('/library-status/parts/private-score-hash'), '/library-status/parts/detail');
  assert.equal(analyticsPath('/members'), '/members');
  assert.equal(analyticsPath('/unexpected/private-path'), '/other');
});


test('GA4 receives standard commands and one sanitized page view per navigation', (t) => {
  const scripts = [];
  globalThis.window = { dataLayer: [] };
  t.after(() => { delete globalThis.window; delete globalThis.document; });
  globalThis.document = {
    referrer: 'https://example.com/private/referral?token=secret',
    createElement: () => ({}),
    head: { appendChild: (script) => scripts.push(script) }
  };

  trackAnalyticsPage(new URL('http://localhost:5173/members/private@example.com'));
  assert.equal(window.dataLayer.length, 0);
  assert.equal(scripts.length, 0);

  trackAnalyticsPage(new URL('https://mbbb-music.mckoss.com/members/private@example.com?token=secret'));
  trackAnalyticsPage(new URL('https://mbbb-music.mckoss.com/gigs/private-gig-id'));
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].src, 'https://www.googletagmanager.com/gtag/js?id=G-WYSGHSNPYC');
  assert.ok(window.dataLayer.every(command => Object.prototype.toString.call(command) === '[object Arguments]'));
  const commands = window.dataLayer.map(command => Array.from(command));
  assert.equal(commands.filter(command => command[0] === 'config').length, 1);
  assert.deepEqual(commands.find(command => command[0] === 'config'),
    ['config', 'G-WYSGHSNPYC', { send_page_view: false }]);
  const views = commands.filter(command => command[0] === 'event');
  assert.equal(views.length, 2);
  assert.equal(views[0][1], 'page_view');
  assert.equal(views[0][2].page_location, 'https://mbbb-music.mckoss.com/members/profile');
  assert.equal(views[1][2].page_location, 'https://mbbb-music.mckoss.com/gigs/detail');
  assert.equal(views[0][2].page_referrer, 'https://example.com');
  assert.doesNotMatch(JSON.stringify(commands), /private|secret|token|@/);
});
