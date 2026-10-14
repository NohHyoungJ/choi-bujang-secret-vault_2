import test from 'node:test';
import assert from 'node:assert/strict';
import { readDetectionEvents, detectFixture as detect } from '../src/detect.mjs';

const events = count => Array.from({ length: count }, () => ({
  at: '2026-10-01T00:00:00.000Z', method: 'GET', identity: { sub: 'learner_fixture' },
}));

test('정상·의심 가상 사건은 네 항목만 추출하고 없는 정보는 null이다', () => {
  for (const count of [30, 121]) {
    const input = events(count);
    const safe = readDetectionEvents(input);
    assert.equal(safe.length, count);
    assert.deepEqual(safe[0], {
      subjectId: 'learner_fixture', deviceId: null, requestKind: 'GET', decision: null,
    });
    assert.deepEqual(detect(input), { action: 'observe' });
  }
});

test('계약 밖의 내용·토큰·실명·기기·판정 속성은 읽지도 않는다', () => {
  const input = events(1)[0];
  for (const name of ['body', 'token', 'realName', 'deviceId', 'decision']) {
    Object.defineProperty(input, name, { get() { throw new Error('unexpected_extra_field_read'); } });
  }
  Object.defineProperty(input.identity, 'realName', {
    get() { throw new Error('unexpected_identity_field_read'); },
  });
  assert.deepEqual(readDetectionEvents([input]), [{
    subjectId: 'learner_fixture', deviceId: null, requestKind: 'GET', decision: null,
  }]);
  assert.deepEqual(detect([input]), { action: 'observe' });
});

test('형식이 잘못된 사건은 내용 없는 고정 사유로 거부한다', () => {
  assert.throws(() => readDetectionEvents(null), { message: 'invalid_detection_events' });
  for (const input of [[null], [{ method: 'GET', identity: {} }],
    [{ method: 'Synthetic unsupported', identity: { sub: 'learner_fixture' } }],
    [{ method: 'GET', identity: { sub: 'synthetic.with.dots' } }]]) {
    assert.throws(() => readDetectionEvents(input), { message: 'invalid_detection_event' });
  }
  assert.throws(() => detect([{ ...events(1)[0], at: 'Synthetic invalid time' }]),
    { message: 'invalid_detection_event' });
});

test('확장 사건에서도 지역·본문·토큰을 읽지 않고 복합 의심만 표시한다', () => {
  const input = events(121).map(event => {
    event.signals = { source: 'judge_fixture', network: 'unusual' };
    for (const name of ['body', 'token', 'realName']) {
      Object.defineProperty(event, name, { get() { throw new Error('unexpected_extra_field_read'); } });
    }
    Object.defineProperty(event.signals, 'region', {
      get() { throw new Error('unexpected_region_read'); },
    });
    return event;
  });
  assert.deepEqual(detect(input), {
    action: 'flag_suspicious', reasonCode: 'unusual_network_burst', subject: 'learner_fixture',
  });
});
