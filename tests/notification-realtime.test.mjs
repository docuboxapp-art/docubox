import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createNotificationRefresh,
  subscribeToNotificationChanges,
} from '../src/lib/notifications/realtime.ts';

function fakeClient() {
  const channels = [];
  const removed = [];
  return {
    channels,
    removed,
    channel(topic) {
      const channel = {
        topic,
        on(type, filter, dispatch) {
          Object.assign(this, { type, filter, dispatch });
          return this;
        },
        subscribe(status) {
          this.status = status;
          return this;
        },
      };
      channels.push(channel);
      return channel;
    },
    async removeChannel(channel) {
      removed.push(channel);
    },
  };
}

test('shares the exact RLS-filtered subscription per browser client and user', async () => {
  const client = fakeClient();
  const anotherClient = fakeClient();
  const events = [];
  const observer = (view) => ({
    onChange: (event) => events.push([view, event]),
    onSubscribed: () => events.push([view, 'ready']),
  });
  const leaveNav = subscribeToNotificationChanges(client, 'user-one', observer('nav'));
  const first = client.channels[0];
  assert.deepEqual(first.filter, {
    event: '*',
    schema: 'public',
    table: 'notifications',
    filter: 'user_id=eq.user-one',
  });
  first.status('SUBSCRIBED');
  const leaveList = subscribeToNotificationChanges(client, 'user-one', observer('list'));
  const leaveOtherUser = subscribeToNotificationChanges(client, 'user-two', observer('other user'));
  const leaveOtherClient = subscribeToNotificationChanges(
    anotherClient,
    'user-one',
    observer('other client')
  );
  assert.equal(client.channels.length, 2);
  assert.equal(anotherClient.channels.length, 1);
  assert.equal(client.channels[1].filter.filter, 'user_id=eq.user-two');
  await Promise.resolve();

  const change = { eventType: 'UPDATE', new: { id: 'n1', read: true } };
  first.dispatch(change);
  assert.deepEqual(events, [
    ['nav', 'ready'],
    ['list', 'ready'],
    ['nav', change],
    ['list', change],
  ]);
  leaveNav();
  assert.deepEqual(client.removed, []);
  first.status('TIMED_OUT');
  first.status('SUBSCRIBED');
  first.dispatch(change);
  assert.deepEqual(events.slice(-2), [
    ['list', 'ready'],
    ['list', change],
  ]);

  leaveList();
  assert.deepEqual(client.removed, [first]);
  const leaveReplacement = subscribeToNotificationChanges(
    client,
    'user-one',
    observer('replacement')
  );
  assert.notEqual(client.channels.at(-1).topic, first.topic);
  first.dispatch(change);
  assert.equal(events.length, 6);
  leaveReplacement();
  leaveOtherUser();
  leaveOtherClient();
});

test('a burst keeps one read in flight and reads the latest state after it completes', async () => {
  const reads = [];
  const snapshots = [];
  let latest = 0;
  const refresh = createNotificationRefresh((signal) => {
    const snapshot = latest;
    return new Promise((resolve, reject) => {
      reads.push({
        signal,
        finish: () => {
          if (!signal.aborted) snapshots.push(snapshot);
          resolve();
        },
        fail: reject,
      });
    });
  });
  refresh.request();
  for (let index = 0; index < 100; index++) {
    latest++;
    refresh.request();
  }
  assert.equal(reads.length, 1);
  reads[0].fail(new Error('Transient transport error'));
  await Promise.resolve();
  assert.equal(reads.length, 2);
  reads[1].finish();
  await Promise.resolve();
  assert.deepEqual(snapshots, [100]);

  refresh.request();
  refresh.request();
  refresh.dispose();
  assert.equal(reads[2].signal.aborted, true);
  reads[2].finish();
  await Promise.resolve();
  refresh.request();
  assert.equal(reads.length, 3);
  assert.deepEqual(snapshots, [100]);
});

test('a timed-out read releases the refresh queue without disposing the view', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const reads = [];
  const refresh = createNotificationRefresh((signal, lifetime) => {
    reads.push({ signal, lifetime });
    return new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  });
  refresh.request();
  refresh.request();
  t.mock.timers.tick(30_000);
  await Promise.resolve();
  assert.equal(reads.length, 2);
  assert.equal(reads[0].signal.aborted, true);
  assert.equal(reads[0].lifetime.aborted, false);
  assert.equal(reads[1].signal.aborted, false);
  refresh.dispose();
  await Promise.resolve();
  assert.equal(reads[1].signal.aborted, true);
});
