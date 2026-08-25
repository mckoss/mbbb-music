import assert from 'node:assert/strict';
import test from 'node:test';

import { createPresenceGroup } from '../src/lib/presence.ts';

const nextTask = () => new Promise((resolve) => setTimeout(resolve, 5));

test('presence group notifies after its last owner leaves', async () => {
  let emptied = 0;
  const mount = createPresenceGroup(() => emptied++);
  const leaveA = mount();
  const leaveB = mount();

  leaveA();
  await nextTask();
  assert.equal(emptied, 0);

  leaveB();
  assert.equal(emptied, 0); // deferred beyond the component cleanup itself
  await nextTask();
  assert.equal(emptied, 1);
});

test('a successor mounting during route transition keeps the resource alive', async () => {
  let emptied = 0;
  const mount = createPresenceGroup(() => emptied++);
  const leaveOldView = mount();

  leaveOldView();
  const leaveNewView = mount();
  await nextTask();
  assert.equal(emptied, 0);

  leaveNewView();
  await nextTask();
  assert.equal(emptied, 1);
});

test('an owner cleanup is idempotent', async () => {
  let emptied = 0;
  const leave = createPresenceGroup(() => emptied++)();

  leave();
  leave();
  await nextTask();
  assert.equal(emptied, 1);
});
