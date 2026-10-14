// ALEPH SDP 엔진이 확인한 요청만 받으며, 등록된 기기 요청만 허용합니다.
// 요청 본문의 userId, role, 기기 키, 토큰을 별도로 믿거나 저장하지 마세요.
export const RULE_IDS = Object.freeze(['device_registered', 'step_up_required']);

// 엔진 요청 계약의 입력만 검사합니다. 가상 신호는 실제 위치 증거가 아닙니다.
// null은 누락·출처 불명·잘못된 형식이며, 정상값으로 대체하지 않습니다.
export function inspectConnectionInput(request) {
  const signals = request?.signals;
  const source = signals?.source === 'judge_fixture' || signals?.source === 'none'
    ? signals.source : 'unknown';
  const fixture = source === 'judge_fixture';
  const knownText = value => typeof value === 'string'
    && value.trim().length > 0 && value.trim() !== 'unknown';
  const events = request?.recentEvents;
  // recentEvents의 출처는 signals.source와 별개로 엔진입니다.
  // 빈 배열은 사건 없음, null은 사건 정보가 없거나 형식이 잘못됨입니다.
  const validEvents = Array.isArray(events) && events.length <= 12
    && Array.from(events).every(event => event !== null
      && typeof event === 'object' && !Array.isArray(event)
      && knownText(event.kind)
      && Number.isFinite(event.ageSeconds) && event.ageSeconds >= 0
      && Number.isSafeInteger(event.count) && event.count >= 0);
  return {
    signalSource: source,
    region: fixture && knownText(signals.region) ? signals.region : null,
    hour: fixture && Number.isInteger(signals.hour)
      && signals.hour >= 0 && signals.hour <= 23 ? signals.hour : null,
    network: fixture && knownText(signals.network) ? signals.network : null,
    behaviorSource: validEvents ? 'engine' : 'unknown',
    recentEvents: validEvents
      ? events.map(({ kind, ageSeconds, count }) => ({ kind, ageSeconds, count }))
      : null,
  };
}

export async function decide(request) {
  const registered = request?.deviceRegistered === true;
  const connection = inspectConnectionInput(request);
  // 평소 접속 이력은 계약에 없으므로 기존 가상 사건의 야간 기준을 사용합니다.
  // risk_signal은 가상 사건의 대량 접근 신호이며 실제 읽기 이력으로 간주하지 않습니다.
  const unusualAccess = connection.signalSource === 'judge_fixture'
    && connection.hour !== null && connection.hour >= 0 && connection.hour < 6
    && connection.network === 'unusual'
    && connection.recentEvents !== null
    && connection.recentEvents.some(event => event.kind === 'risk_signal'
      && event.ageSeconds <= 60 && event.count >= 20);
  // 미등록 기기 거부가 우선이며 지역만으로 차단하지 않습니다.
  // 제공 연습의 가상 재확인 결과만 처리합니다. 실제 새 로그인 증거가 아닙니다.
  const fixtureConfirmed = connection.signalSource === 'judge_fixture'
    && request?.stepUp?.verified === true
    && Number.isFinite(request.stepUp.authAgeSeconds)
    && request.stepUp.authAgeSeconds >= 0 && request.stepUp.authAgeSeconds <= 900;
  const needsStepUp = registered && unusualAccess && !fixtureConfirmed;
  return {
    schema: 'aleph.decision.v1',
    requestId: request.requestId,
    decision: !registered ? 'deny' : needsStepUp ? 'step_up' : 'allow',
    reasonCode: !registered ? 'device_not_registered'
      : needsStepUp ? 'step_up_required' : 'approved',
    ruleIds: needsStepUp ? ['device_registered', 'step_up_required'] : ['device_registered'],
  };
}
