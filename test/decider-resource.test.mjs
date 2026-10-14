import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decide } from '../src/decider.mjs';
import { fixtureRequests } from '../scripts/fixture-7.mjs';

const request = (service, method, path, route, extra = {}) => ({
  ...fixtureRequests().normal, service, method, path, route, ...extra,
});
const check = async (input, decision, reasonCode) => {
  const result = await decide(input);
  assert.equal(result.decision, decision);
  if (reasonCode) assert.equal(result.reasonCode, reasonCode);
  assert.deepEqual(Object.keys(result).sort(),
    ['decision', 'reasonCode', 'requestId', 'ruleIds', 'schema']);
};

test('설정의 모든 허용 경로는 정확한 서비스와 경로로만 허용된다', async () => {
  const config = JSON.parse(readFileSync(new URL('../aleph.config.json', import.meta.url)));
  for (const route of config.allowedRoutes) {
    const [method, template] = route.split(' ');
    const service = template.includes('notes') && !template.includes('notices') ? 'notes' : 'notices';
    const path = template.replace(':id', 'synthetic-note');
    await check(request(service, method, path, route), 'allow', 'approved');
    await check(request('unknown', method, path, route), 'deny', 'resource_not_allowed');
  }
});

test('전체 메모·공지 쓰기·강사 자료·기능/변조 경로는 거부한다', async () => {
  for (const base of ['/api/learning-notes', '/api/notes', '/notes']) {
    for (const method of ['GET', 'POST']) {
      await check(request('notes', method, base, `${method} ${base}`), 'deny', 'resource_not_allowed');
    }
    for (const suffix of ['', 'export', '%65xport', 'a/b', '..', '%2f', 'a?mode=export', 'a#x']) {
      await check(request('notes', 'GET', `${base}/${suffix}`, `GET ${base}/:id`), 'deny', 'resource_not_allowed');
    }
    await check(request('notes', 'GET', `${base}/demo`, `GET ${base}/:id`, { queryLength: 11 }),
      'deny', 'resource_not_allowed');
    await check(request('notices', 'GET', `${base}/demo`, `GET ${base}/:id`), 'deny', 'resource_not_allowed');
    await check(request('notes', 'GET', `${base}/demo`, `GET ${base}`), 'deny', 'resource_not_allowed');
  }
  for (const base of ['/api/instructor-notices', '/api/notices', '/notices']) {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      for (const suffix of ['', '/demo']) {
        await check(request('notices', method, base + suffix,
          `${method} ${base}${suffix ? '/:id' : ''}`), 'deny', 'resource_not_allowed');
      }
    }
  }
  for (const service of ['instructor', 'instructor_materials', 'notes']) {
    await check(request(service, 'GET', '/api/instructor-materials/demo',
      'GET /api/instructor-materials/:id'), 'deny', 'resource_not_allowed');
  }
});

test('기기·복합 이상·가상 재확인 규칙을 유지한다', async () => {
  const { normal, suspicious } = fixtureRequests();
  await check(normal, 'allow', 'approved');
  await check(suspicious, 'step_up', 'step_up_required');
  await check({ ...suspicious, stepUp: { verified: true, authAgeSeconds: 60 } }, 'allow', 'approved');
  await check({ ...suspicious, deviceRegistered: false }, 'deny', 'device_not_registered');
  await check({ ...suspicious, service: 'instructor_materials' }, 'deny', 'resource_not_allowed');
});
