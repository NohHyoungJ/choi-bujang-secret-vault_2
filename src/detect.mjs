// 9단계 로컬 가상 사건의 복합 의심 표시입니다. 실제 접속을 회수하지 않습니다.
// 반 엔진이 검증한 사건만 전달해야 하며, 브라우저가 보낸 사용자 번호는 받지 않습니다.
const REQUEST_KINDS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

// 제공된 로컬 계약의 가명 주체·요청 종류만 추출합니다.
// 기기와 판정은 계약에 없으므로 임의로 읽거나 정상값을 채우지 않습니다.
export function readDetectionEvents(events) {
  if (!Array.isArray(events)) throw new TypeError('invalid_detection_events');
  const safeEvents = [];
  for (const event of events) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      throw new TypeError('invalid_detection_event');
    }
    const subjectId = event.identity?.sub;
    const requestKind = event.method;
    // 연락처·공백·JWT 형태를 제외합니다. 실제 가명 여부는 사건 제공 엔진의 책임입니다.
    if (typeof subjectId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(subjectId)
        || /^(?:sb_secret_|sb_publishable_|sk-|Bearer)/iu.test(subjectId)
        || !REQUEST_KINDS.has(requestKind)) {
      throw new TypeError('invalid_detection_event');
    }
    safeEvents.push({ subjectId, deviceId: null, requestKind, decision: null });
  }
  return safeEvents;
}

export function detect(events) {
  const safeEvents = readDetectionEvents(events);
  const readsBySubject = new Map();
  for (let index = 0; index < events.length; index++) {
    const { subjectId, requestKind } = safeEvents[index];
    const event = events[index];
    const timestamp = typeof event.at === 'string' ? Date.parse(event.at) : NaN;
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== event.at) {
      throw new TypeError('invalid_detection_event');
    }
    // 승인된 로컬 가상 계약만 사용합니다. 지역·출처 불명 정보는 조건에 넣지 않습니다.
    if (requestKind !== 'GET' || event.signals?.source !== 'judge_fixture'
        || event.signals.network !== 'unusual') continue;
    if (!readsBySubject.has(subjectId)) readsBySubject.set(subjectId, []);
    const evidence = event.fixtureDevice;
    const deviceId = evidence?.source === 'judge_fixture' && evidence.verified === true
      && typeof evidence.id === 'string' && /^[a-f0-9]{16}$/u.test(evidence.id)
      ? evidence.id : null;
    readsBySubject.get(subjectId).push({ timestamp, deviceId });
  }
  let suspicious = null;
  for (const [subject, reads] of [...readsBySubject].sort(([a], [b]) => a.localeCompare(b))) {
    reads.sort((a, b) => a.timestamp - b.timestamp);
    const deviceCounts = new Map();
    let start = 0;
    for (let end = 0; end < reads.length; end++) {
      const deviceId = reads[end].deviceId;
      if (deviceId !== null) deviceCounts.set(deviceId, (deviceCounts.get(deviceId) ?? 0) + 1);
      while (reads[end].timestamp - reads[start].timestamp > 10 * 60 * 1000) {
        const expiredDevice = reads[start++].deviceId;
        if (expiredDevice !== null) {
          const count = deviceCounts.get(expiredDevice) - 1;
          if (count === 0) deviceCounts.delete(expiredDevice);
          else deviceCounts.set(expiredDevice, count);
        }
      }
      if (end - start + 1 > 120) {
        const result = { action: 'flag_suspicious', reasonCode: 'unusual_network_burst', subject };
        suspicious ??= result;
        const target = [...deviceCounts].filter(([, count]) => count > 120)
          .map(([id]) => id).sort()[0];
        if (target !== undefined) {
          return { ...result, revocationProposal: {
            action: 'propose_revocation', deviceId: target, reasonCode: 'unusual_network_burst',
          } };
        }
      }
    }
  }
  return suspicious ?? { action: 'observe' };
}
