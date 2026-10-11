const PATTERNS = Object.freeze([
  Object.freeze({
    name: '같은 출발 주소의 짧은 시간 내 로그인 실패 반복',
    condition: '경보 시각과 설명의 시간 범위를 확인하여 같은 data.srcip에서 로그인 실패가 연속·다량 발생했는지 찾는다. data.count가 있으면 실패 횟수를 보조 확인한다. 단일 경보의 timestamp만으로 반복 시간 범위를 추정하지 않으며, rule.level만으로 공격을 확정하지 않는다. 특정 시간·횟수 임계값은 여기서 정하지 않는다.',
    evidence: 'MITRE ATT&CK T1110은 반복적인 비밀번호 추측을 설명하고 짧은 시간의 반복 인증 실패를 탐지 신호로 제시한다: https://attack.mitre.org/techniques/T1110/',
  }),
  Object.freeze({
    name: '여러 계정에 같은 비밀번호를 대입하는 패스워드 스프레이',
    condition: 'rule.description에 여러 계정에 동일한 비밀번호를 시도했다는 명시적 근거가 있는지 확인하고, data.accounts가 있으면 서로 다른 대상 계정을 보조 확인한다. 계정 수나 실패 횟수만으로 동일 비밀번호 사용을 단정하지 않으며 비밀번호 원문을 수집·출력하지 않는다.',
    evidence: 'MITRE ATT&CK T1110의 하위 기법 T1110.003은 하나 또는 소수의 비밀번호를 여러 계정에 시도하는 패스워드 스프레이를 설명한다: https://attack.mitre.org/techniques/T1110/003/',
  }),
]);

// Local learning heuristics, not thresholds or probabilities specified by MITRE.
const SCORING = Object.freeze({ manyFailures: 20, shortMinutes: 5, supportingLevel: 10 });

export function decide(alert) {
  const description = typeof alert?.rule?.description === 'string'
    ? alert.rule.description.slice(0, 2000) : '';
  const data = alert?.data;
  const level = Number.isInteger(alert?.rule?.level) ? alert.rule.level : 0;
  const rawCount = data?.count;
  const describedCount = description.match(/실패(?:가|는)?\s*(\d+)\s*건/u)?.[1];
  const countText = typeof rawCount === 'number' ? String(rawCount)
    : typeof rawCount === 'string' ? rawCount.trim() : describedCount;
  const count = typeof countText === 'string' && /^\d{1,9}$/u.test(countText) ? Number(countText) : null;
  const accounts = typeof data?.accounts === 'string'
    ? new Set(data.accounts.slice(0, 2000).split(',').map(value => value.trim()).filter(Boolean)).size : 0;
  const source = typeof data?.srcip === 'string' && data.srcip.length <= 45
    && /^(?:\d{1,3}(?:\.\d{1,3}){3}|[a-f\d:]+:[a-f\d:]*)$/iu.test(data.srcip);
  const authContext = /로그인|인증|계정|비밀번호/u.test(description)
    || (Array.isArray(alert?.rule?.mitre) && alert.rule.mitre.includes('T1110'));
  const failures = /실패/u.test(description) && authContext;
  const attempts = /대입|넣었|넣는|시도|실패/u.test(description);
  const samePassword = /(?:같은|동일한?)\s*비밀번호/u.test(description)
    && !/(?:같은|동일한?)\s*비밀번호.{0,20}(?:아니|않)/u.test(description);
  const multipleAccounts = accounts > 1 || /여러\s*계정|서로\s*다른\s*계정|계정\s*(?:[2-9]|\d{2,})\s*개/u.test(description);
  let confidence = 0;
  let reason = '일치하는 근거 패턴 없음';
  if (samePassword && multipleAccounts && attempts) {
    confidence = 0.95;
    reason = PATTERNS[1].name;
  }
  if (failures) {
    const minutes = Number(description.match(/(\d+)\s*분/u)?.[1]);
    const shortWindow = minutes > 0 && minutes <= SCORING.shortMinutes;
    let repetition = count !== null && count >= 2 ? 0.55 : /연속|반복|이어졌|쌓였/u.test(description) ? 0.55 : 0.25;
    if (count !== null && count >= SCORING.manyFailures) {
      repetition = source && shortWindow ? 0.95
        : source && level >= SCORING.supportingLevel ? 0.88 : 0.75;
    } else if (count !== null && count >= 2 && shortWindow && source) {
      repetition = 0.65;
    }
    // A one-off failure followed by success is weak evidence even at a high level.
    if (count !== null && count <= 1) repetition = 0.25;
    if (repetition > confidence) {
      confidence = repetition;
      reason = PATTERNS[0].name;
    }
  }
  return {
    action: confidence >= 0.85 ? 'block' : confidence >= 0.5 ? 'alert' : 'record',
    confidence,
    reason,
  };
}
