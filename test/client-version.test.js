import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CLIENT_VERSION_FIELD,
  clientVersionFromForm,
  normalizeClientVersion,
} from '../src/lib/client-version.ts';

test('client versions accept semver and reject missing or malformed context', () => {
  assert.equal(normalizeClientVersion('1.50.1'), '1.50.1');
  assert.equal(normalizeClientVersion('2.0.0-beta.1'), '2.0.0-beta.1');
  assert.equal(normalizeClientVersion('unknown'), null);
  assert.equal(normalizeClientVersion(null), null);
});

test('an exact submitted form version wins over request fallback', () => {
  const form = new FormData();
  form.set(CLIENT_VERSION_FIELD, '1.49.4');
  assert.equal(clientVersionFromForm(form, '1.50.1'), '1.49.4');

  const legacy = new FormData();
  assert.equal(clientVersionFromForm(legacy, '1.50.1'), '1.50.1');
  assert.equal(clientVersionFromForm(legacy, null), null);
});
