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
  },
  {
    "name": "요청 인자의 명령 구분자 주입 형태",
    "condition": "요청 인자에 명령 구분자와 명령 구문이 결합되거나, 경보 설명에서 명령 구분자 삽입이 명시되는지 확인한다. 같은 출발 주소의 반복과 높은 규칙 수준이 함께 있을 때만 차단 후보로 삼는다. 단순 구분 문자 하나는 공격으로 확정하지 않는다.",
    "evidence": "공개 앱 입력 악용의 맥락은 MITRE T1190이며, 명령 구분자로 명령을 이어 붙이는 직접 근거는 OWASP Command Injection 설명이다: https://attack.mitre.org/techniques/T1190/ ; https://community.owasp.org/attacks/Command_Injection"
  },
  {
    "name": "주입 관련 단발성 의심 신호",
    "condition": "T1190으로 분류된 중간 수준 경보에 단발성 따옴표·SQL 또는 스크립트 단어·경로 이동 단어·구분 문자·비정상 검색이나 긴 요청 등의 약한 신호만 있으면 알림으로 남긴다. 단어와 예제만으로 공격을 확정하거나 차단하지 않는다. 해당 신호가 없는 정상 조회는 기록만 한다.",
    "evidence": "SQL 주입·XSS·경로 탐색·명령 주입의 입력 신호를 관찰하되, 단발성 약한 일치는 공격 확정 근거가 부족하므로 알림으로 분류하는 학습용 정책이다: https://community.owasp.org/attacks/SQL_Injection ; https://community.owasp.org/attacks/xss/ ; https://community.owasp.org/attacks/Path_Traversal ; https://community.owasp.org/attacks/Command_Injection"
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
  const scores = [0, 0, 0, 0, 0];

  const sql = /\bunion\s+(?:all\s+)?select\b/i.test(input)
    || /['"]\s*(?:or|and)\s+(?:\d+\s*=\s*\d+|'[^'\n]*'\s*=\s*'[^'\n]*')\s*(?:--|#|\/\*)/i.test(input);
  const script = /<script\b[^>]*>[\s\S]*?<\/script\s*>/i.test(input);
  const executableScript = script && /<script\b[^>]*(?:\bsrc\s*=|>[\s\S]*?(?:\w+\s*\(|document\.|window\.))/i.test(input);
  const traversal = /(?:\.\.[/\\]){2,}/.test(input);
  const command = /(?:;|&&|\|\|)\s*(?:id|whoami|cat|ls|curl|wget|sh|bash|cmd|powershell)\b/i.test(input);
  const benignContext = /(?:수업|교육용|예제|안전하게 표시|escaped|tutorial|example)/i.test(description);

  // Descriptions can represent redacted payloads; IDs and placeholder names are not evidence.
  const described = [
    /SQL\s*(?:구문|표식)|데이터베이스 조회를 이어 붙이는/i.test(description),
    /스크립트\s*(?:삽입|표식)|script injection|cross.site scripting/i.test(description),
    /경로(?:를 여러 단계 거슬러| 이탈)|directory traversal|path traversal/i.test(description),
    /명령 구분자|command injection|shell injection/i.test(description),
  ];
  const direct = [sql, executableScript, traversal, command];
  for (let i = 0; i < direct.length; i += 1) {
    if (direct[i]) scores[i] = benignContext ? 0.55 : (corroborated ? 0.95 : 0.8);
    if (described[i] && !benignContext) {
      scores[i] = Math.max(scores[i], corroborated ? 0.9 : 0.6);
    }
  }
  if (script && !executableScript) scores[1] = Math.max(scores[1], benignContext ? 0.25 : 0.55);

  const mitre = alert?.rule?.mitre;
  const tagged = Array.isArray(mitre) && mitre.some(item => item === 'T1190')
    || (mitre && Array.isArray(mitre.id) && mitre.id.includes('T1190'));
  const weakSignal = /따옴표|\bSQL\b|\bselect\b|스크립트|\bscript\b|경로.*\bup\b|구분 문자|이상한 검색|주입처럼|주소가.*깁니다/i.test(description);
  if (tagged && count === 1 && level >= 5 && level <= 8 && weakSignal) {
    scores[4] = 0.5;
  }

  const confidence = Math.max(...scores);
  const index = scores.indexOf(confidence);
  return {
    action: confidence >= 0.85 ? 'block' : confidence >= 0.5 ? 'alert' : 'record',
    confidence,
    reason: confidence > 0 ? PATTERNS[index].name : '일치하는 근거 패턴 없음',
  };
}
