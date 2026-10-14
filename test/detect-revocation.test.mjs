import test from 'node:test';
import assert from 'node:assert/strict';
import { detect } from '../src/detect.mjs';

const deviceA = 'a'.repeat(16);
const deviceB = 'b'.repeat(16);
const reads = (count, { id = deviceA, verified = true, source = 'judge_fixture',
  network = 'unusual', subject = 'learner_fixture', interval = 2000 } = {}) =>
  Array.from({ length: count }, (_, index) => ({
    at: new Date(Date.UTC(2026, 9, 1) + index * interval).toISOString(),
    identity: { sub: subject }, method: 'GET',
    signals: { source: 'judge_fixture', network },
    fixtureDevice: { source, verified, id },
  }));

test('확인된 한 가상 기기의 복합 조회만 별도 회수 제안을 만든다', () => {
  const input = reads(121);
  const original = structuredClone(input);
  assert.deepEqual(detect(input), {
    action: 'flag_suspicious', reasonCode: 'unusual_network_burst', subject: 'learner_fixture',
    revocationProposal: { action: 'propose_revocation', deviceId: deviceA,
      reasonCode: 'unusual_network_burst' },
  });
  assert.deepEqual(input, original, '입력 사건·기기 권한을 변경하지 않음');
});

test('정상·단일 이상·정확히 120건은 제안하지 않는다', () => {
  for (const input of [reads(30), reads(120), reads(200, { network: 'usual' }),
    reads(200, { interval: 7000 })]) assert.deepEqual(detect(input), { action: 'observe' });
});

test('미확인·출처 불명·기기 누락·잘못된 ID에는 회수 제안이 없다', () => {
  for (const input of [reads(121, { verified: false }), reads(121, { source: 'unknown' }),
    reads(121, { id: 'synthetic-invalid-id' }), reads(121).map(({ fixtureDevice, ...event }) => event)]) {
    assert.equal(detect(input).action, 'flag_suspicious');
    assert.equal(Object.hasOwn(detect(input), 'revocationProposal'), false);
  }
});

test('다른 기기·다른 사용자의 조회는 회수 근거로 합치지 않는다', () => {
  const mixed = [...reads(70), ...reads(60, { id: deviceB })];
  assert.equal(detect(mixed).action, 'flag_suspicious');
  assert.equal(Object.hasOwn(detect(mixed), 'revocationProposal'), false);
  assert.deepEqual(detect([...reads(100), ...reads(100, { subject: 'other_fixture' })]),
    { action: 'observe' });
});

test('여러 후보가 있어도 한 기기만 제안하고 앞선 미확인 의심에 가려지지 않는다', () => {
  const input = [...reads(121, { id: deviceB }), ...reads(121)];
  const result = detect(input);
  assert.ok([deviceA, deviceB].includes(result.revocationProposal.deviceId));
  assert.equal(Array.isArray(result.revocationProposal), false);
  const mixed = [...reads(70), ...reads(60, { id: deviceB }), ...reads(60)];
  assert.equal(detect(mixed).revocationProposal.deviceId, deviceA);
});
