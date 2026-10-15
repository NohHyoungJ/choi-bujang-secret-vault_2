import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decide, RULE_IDS } from '../src/decider.mjs';
import { fixtureRequests } from '../scripts/fixture-7.mjs';

// docs/DECIDER_REQUEST.md v1. Unknown reads fail, even if they would return undefined.
const REQUEST_FIELDS = ['schema', 'requestId', 'classId', 'projectId', 'subjectId',
  'deviceId', 'service', 'method', 'path', 'route', 'queryLength', 'querySha256',
  'at', 'policyRevision', 'deviceRegistered', 'stepUp', 'recentEvents', 'signals'];
function contractOnly(object, fields) {
  return new Proxy(object, {
    get(target, property, receiver) {
      if (typeof property === 'string') assert.ok(fields.includes(property),
        `contract does not include ${property}`);
      return Reflect.get(target, property, receiver);
    },
  });
}
function guarded(request) {
  return contractOnly({ ...request,
    signals: request.signals && contractOnly(request.signals, ['source', 'region', 'network', 'hour']),
    stepUp: request.stepUp && contractOnly(request.stepUp, ['verified', 'authAgeSeconds']),
    recentEvents: Array.isArray(request.recentEvents)
      ? request.recentEvents.map(event => event && typeof event === 'object'
        ? contractOnly(event, ['kind', 'ageSeconds', 'count']) : event) : request.recentEvents,
  }, REQUEST_FIELDS);
}
async function check(request) {
  const response = await decide(guarded(request));
  assert.deepEqual(Object.keys(response).sort(),
    ['decision', 'reasonCode', 'requestId', 'ruleIds', 'schema']);
  assert.equal(response.schema, 'aleph.decision.v1');
  assert.equal(response.requestId, request.requestId);
  assert.ok(['allow', 'deny', 'step_up'].includes(response.decision));
  assert.match(response.reasonCode, /^[a-z][a-z0-9_]{0,63}$/u);
  assert.ok(Array.isArray(response.ruleIds) && response.ruleIds.length > 0);
  assert.ok(response.ruleIds.every(id => RULE_IDS.includes(id)));
  return response;
}

test('all configured routes and virtual denials read only contract fields and return registered rules', async () => {
  const config = JSON.parse(readFileSync(new URL('../aleph.config.json', import.meta.url)));
  const { normal, suspicious } = fixtureRequests();
  for (const route of config.allowedRoutes) {
    const [method, template] = route.split(' ');
    const service = template.includes('notices') ? 'notices' : 'notes';
    for (const base of [normal, suspicious]) {
      for (const deviceRegistered of [true, false, undefined]) {
        const result = await check({ ...base, service, method, route,
          path: template.replace(':id', 'virtual-id'), deviceRegistered });
        assert.equal(result.decision, deviceRegistered !== true ? 'deny'
          : base === suspicious ? 'step_up' : 'allow');
      }
    }
  }
  for (const extra of [
    { service: 'unknown' }, { path: '/notes' }, { path: '/notes/export' },
    { path: '/instructor-materials/private' }, { method: 'POST' }, { queryLength: 1 },
  ]) assert.equal((await check({ ...normal, ...extra })).decision, 'deny');
});

test('missing or invalid optional connection inputs still return the five response fields', async () => {
  const { normal, suspicious } = fixtureRequests();
  for (const signals of [undefined, null, {}, normal.signals, suspicious.signals,
    { source: 'none', region: 'unknown', network: 'unknown', hour: null }]) {
    for (const stepUp of [undefined, null, {}, { verified: false, authAgeSeconds: null },
      { verified: true, authAgeSeconds: 60 }, { verified: true, authAgeSeconds: -1 }]) {
      for (const recentEvents of [undefined, null, [], suspicious.recentEvents, [null]]) {
        await check({ ...normal, signals, stepUp, recentEvents });
      }
    }
  }
});

test('project stage is at least 11', () => {
  const config = JSON.parse(readFileSync(new URL('../aleph.config.json', import.meta.url)));
  assert.ok(Number.isInteger(config.step) && config.step >= 11);
});
