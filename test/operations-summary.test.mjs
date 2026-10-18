import test from 'node:test';
import assert from 'node:assert/strict';
import { createOperationsHandler } from '../api/operations-summary.js';
import { RULE_IDS } from '../src/decider.mjs';
import { setupOperationsRoom } from '../public/operations-room.mjs';

async function invoke(overrides = {}, requestChanges = {}) {
  const records = [];
  const handler = createOperationsHandler({ verifyLogin: async () => ({ userId: 'private-user' }),
    readApproval: async () => ({ status: 'approved', deviceRegistered: true }),
    writeRecord: value => records.push(value), ...overrides });
  const response = { headers: {}, setHeader(k, v) { this.headers[k] = v; },
    status(value) { this.code = value; return this; }, json(value) { this.data = value; } };
  await handler({ url: '/api/operations-summary', method: 'GET', headers: {
    'x-vault-request': '1', authorization: 'test-placeholder' }, ...requestChanges }, response);
  return { response, records };
}

test('API snapshot equals masked server record; unavailable data remains null, never zero', async () => {
  const { response, records } = await invoke();
  assert.equal(response.code, 200);
  assert.deepEqual(records, [response.data]);
  assert.deepEqual(response.data.rules.names, [...RULE_IDS]);
  assert.equal(response.data.rules.count, RULE_IDS.length);
  assert.equal(response.data.detection.eventCount, null);
  assert.equal(response.data.revocation.completedCount, null);
  assert.equal(response.data.recovery.restoredVersion, null);
  assert.equal(response.data.verification.total, 41);
  assert.equal(response.data.verification.measured, 0);
  assert.equal(response.data.verification.passed, 0);
  assert.equal(new Set(response.data.verification.rows.map(row => row.id)).size, 41);
  assert.equal(new Set(response.data.verification.rows.map(row => row.step)).size, 11);
  assert(response.data.verification.rows.every(row => row.status === 'not_run'
    && row.actual === null && row.requestId === null && row.checkedAt === null));
  assert(response.data.verification.rows.some(row => row.kind === 'normal'));
  assert(response.data.verification.rows.some(row => row.kind === 'forbidden'));
  assert(!JSON.stringify(response.data).includes('private-user'));
  assert.match(response.headers['Cache-Control'], /no-store/);
});

test('unauthenticated, unapproved, unavailable and cross-site calls reveal no snapshot', async () => {
  for (const [overrides, changes, expected] of [
    [{}, { headers: { 'x-vault-request': '1' } }, 401],
    [{ verifyLogin: async () => null }, {}, 401],
    [{ readApproval: async () => ({ status: 'pending', deviceRegistered: false }) }, {}, 403],
    [{ readApproval: async () => ({ status: 'unavailable' }) }, {}, 503],
    [{ writeRecord: () => { throw Error('private-error'); } }, {}, 503],
    [{}, { headers: { 'x-vault-request': '1', 'sec-fetch-site': 'cross-site' } }, 403],
    [{}, { method: 'POST' }, 405],
  ]) {
    const { response, records } = await invoke(overrides, changes);
    assert.equal(response.code, expected);
    assert.deepEqual(Object.keys(response.data), ['error']);
    assert.equal(records.length, 0);
  }
});

function ui() {
  const elements = new Map();
  const element = () => ({ textContent: '', children: [], disabled: false,
    replaceChildren() { this.children = []; }, append(...items) { this.children.push(...items); },
    addEventListener() {} });
  const document = { querySelector(id) {
    if (!elements.has(id)) elements.set(id, element()); return elements.get(id);
  }, createElement: element };
  return { document, elements };
}

test('UI renders same API numbers and record ID, clears data on lock and late responses', async () => {
  const { response } = await invoke();
  const { document, elements } = ui();
  let allowed = true;
  let finish;
  let delayed = false;
  const room = setupOperationsRoom({ document, isAllowed: () => allowed, onDenied() {},
    fetch: async () => {
      if (delayed) await new Promise(resolve => { finish = resolve; });
      return { ok: true, json: async () => response.data };
    } });
  await room.refresh();
  const cards = elements.get('#operations-cards');
  assert.equal(cards.children.length, 4);
  assert.match(cards.children[0].children[1].textContent, new RegExp(`${RULE_IDS.length}개`));
  assert(cards.children.slice(1).every(card => card.children[1].textContent.includes('미실행')));
  assert(elements.get('#operations-status').textContent.includes(response.data.recordId));
  assert.equal(elements.get('#verification-rows').children.length, 41);
  assert(elements.get('#verification-status').textContent.includes('실측 0'));
  delayed = true;
  const pending = room.refresh();
  allowed = false; room.clear(); finish(); await pending;
  assert.equal(cards.children.length, 0);
  assert.equal(elements.get('#verification-rows').children.length, 0);
  assert(!elements.get('#operations-status').textContent.includes(response.data.recordId));
});
