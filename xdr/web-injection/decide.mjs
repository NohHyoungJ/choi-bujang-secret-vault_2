const PATTERNS = [
  {
    "name": "요청 인자의 SQL 주입 형태",
    "condition": "요청 인자에 SQL 구문 구조가 들어 있는지 확인한다. UNION과 SELECT의 조합, 입력 경계를 벗어나는 따옴표와 OR 비교식·주석의 조합 등을 근거로 삼는다. URL 인코딩은 실행 없이 문자열로 해석하며, SQL 단어 하나나 교육용 검색 문구만으로 공격을 확정하지 않는다.",
    "evidence": "MITRE ATT&CK T1190은 외부 공개 앱의 취약점 악용과 SQL 주입 사례를 설명하며, OWASP는 입력에 삽입한 SQL 구문으로 질의를 변조하는 형태를 설명한다: https://attack.mitre.org/techniques/T1190/ ; https://community.owasp.org/attacks/SQL_Injection"
  },
  {
    "name": "요청 인자의 스크립트 태그 삽입 형태",
    "condition": "요청 인자에 실제 또는 URL 인코딩된 스크립트 태그가 포함되는지 확인한다. 태그 안 실행 구문과 경보 설명을 함께 살피되 문자열은 실행하지 않는다. script라는 단어, 안전하게 표시된 예제나 단순 태그 존재만으로 실행 성공 또는 서버 침해를 확정하지 않는다.",
    "evidence": "MITRE ATT&CK T1190은 공개 앱 악용의 상위 맥락이며, 스크립트 태그 삽입의 직접 근거는 OWASP XSS 설명이다. 태그 존재만으로 T1190 성공을 뜻하지 않는다: https://attack.mitre.org/techniques/T1190/ ; https://community.owasp.org/attacks/xss/"
  },
  {
    "name": "상위 디렉터리 이동을 반복하는 경로 탐색 형태",
    "condition": "파일·경로 요청 인자에 ../ 또는 동등한 인코딩 형태가 반복되는지 확인한다. 상위 경로 이동과 접근 대상·경보 설명을 함께 살피며 실제 파일 접근은 하지 않는다. 정상 상대 경로의 한 번 이동이나 설명 문구만으로 공격을 확정하지 않는다.",
    "evidence": "MITRE ATT&CK T1190에는 디렉터리 탐색 취약점 악용 사례가 있고, OWASP는 ../ 및 인코딩 변형으로 허용 디렉터리 밖의 파일을 노리는 형태를 설명한다: https://attack.mitre.org/techniques/T1190/ ; https://community.owasp.org/attacks/Path_Traversal"
  }
];

// These confidence scores are local heuristics, not MITRE thresholds.
function text(value) {
  return typeof value === 'string' ? value.slice(0, 16000) : '';
}

function decode(value) {
  let result = text(value);
  for (let i = 0; i < 2; i += 1) {
    try {
      const next = decodeURIComponent(result.replace(/\+/g, ' '));
      if (next === result) break;
      result = next;
    } catch { break; }
  }
  return result;
}

function argumentsText(data) {
  const url = text(data.url);
  const query = url.includes('?') ? url.slice(url.indexOf('?') + 1).split('#')[0] : '';
  const values = [query];
  for (const key of ['args', 'query', 'params', 'body']) {
    const value = data[key];
    if (typeof value === 'string') values.push(value);
    else if (value && typeof value === 'object' && !Array.isArray(value)) {
      values.push(...Object.values(value).filter(item => typeof item === 'string').slice(0, 40));
    }
  }
  return values.map(decode).join('\n').slice(0, 64000);
}

export function decide(alert) {
  const data = alert?.data && typeof alert.data === 'object' ? alert.data : {};
  const description = text(alert?.rule?.description);
  const input = argumentsText(data);
  const level = Number(alert?.rule?.level);
  const count = Number(data.count);
  const repeated = Number.isFinite(count) && count >= 5;
  const corroborated = Number.isFinite(level) && level >= 10 && repeated && Boolean(text(data.srcip));
  const scores = [0, 0, 0];

  const sql = /\bunion\s+(?:all\s+)?select\b/i.test(input)
    || /['"]\s*(?:or|and)\s+(?:\d+\s*=\s*\d+|'[^'\n]*'\s*=\s*'[^'\n]*')\s*(?:--|#|\/\*)/i.test(input);
  const script = /<script\b[^>]*>[\s\S]*?<\/script\s*>/i.test(input);
  const executableScript = script && /<script\b[^>]*(?:\bsrc\s*=|>[\s\S]*?(?:\w+\s*\(|document\.|window\.))/i.test(input);
  const traversal = /(?:\.\.[/\\]){2,}/.test(input);
  const benignContext = /(?:수업|교육용|예제|안전하게 표시|escaped|tutorial|example)/i.test(description);

  // Descriptions can represent redacted payloads; IDs and placeholder names are not evidence.
  const described = [
    /SQL\s*(?:구문|표식)|데이터베이스 조회를 이어 붙이는/i.test(description),
    /스크립트\s*(?:삽입|표식)|script injection|cross.site scripting/i.test(description),
    /경로(?:를 여러 단계 거슬러| 이탈)|directory traversal|path traversal/i.test(description),
  ];
  const direct = [sql, executableScript, traversal];
  for (let i = 0; i < scores.length; i += 1) {
    if (direct[i]) scores[i] = benignContext ? 0.55 : (corroborated ? 0.95 : 0.8);
    if (described[i] && !benignContext) {
      scores[i] = Math.max(scores[i], corroborated ? 0.9 : 0.6);
    }
  }
  if (script && !executableScript) scores[1] = Math.max(scores[1], benignContext ? 0.25 : 0.55);

  const confidence = Math.max(...scores);
  const index = scores.indexOf(confidence);
  return {
    action: confidence >= 0.85 ? 'block' : confidence >= 0.5 ? 'alert' : 'record',
    confidence,
    reason: confidence > 0 ? PATTERNS[index].name : '일치하는 근거 패턴 없음',
  };
}