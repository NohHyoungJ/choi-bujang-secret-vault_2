export function setupOperationsRoom({ document, fetch, isAllowed, onDenied }) {
  const message = document.querySelector('#operations-status');
  const list = document.querySelector('#operations-cards');
  const button = document.querySelector('#refresh-operations');
  const verificationRows = document.querySelector('#verification-rows');
  const verificationStatus = document.querySelector('#verification-status');
  let generation = 0;
  function clear() {
    ++generation;
    list.replaceChildren();
    verificationRows.replaceChildren();
    verificationStatus.textContent = '시험 기록 미확인';
    message.textContent = '미확인 · 로그인과 기기 승인 후 서버 요약을 조회하세요.';
  }
  async function refresh() {
    const version = ++generation;
    list.replaceChildren();
    verificationRows.replaceChildren();
    verificationStatus.textContent = '시험 기록 조회 중';
    if (!isAllowed()) { clear(); return; }
    button.disabled = true;
    message.textContent = '서버 요약을 확인하는 중입니다.';
    try {
      const response = await fetch('/api/operations-summary', {
        credentials: 'same-origin', cache: 'no-store', headers: { 'X-Vault-Request': '1' },
      });
      if (version !== generation || !isAllowed()) return;
      if (!response.ok) {
        if ([401, 403, 503].includes(response.status)) onDenied();
        throw new Error('summary_unavailable');
      }
      const data = await response.json();
      if (version !== generation || !isAllowed()) return;
      if (data.schema !== 'vault.operations-summary.v1' || !Array.isArray(data.rules?.names)
          || data.rules.count !== data.rules.names.length) throw new Error('invalid_summary');
      if (!Array.isArray(data.verification?.rows) || data.verification.total !== data.verification.rows.length
          || data.verification.rows.some(row => row.status !== 'not_run' || row.actual !== null
            || row.requestId !== null || row.checkedAt !== null || row.evidence !== null)
          || data.verification.measured !== 0 || data.verification.passed !== 0) {
        throw new Error('unverified_measurements');
      }
      const missing = '미실행·확인 불가 (운영 기록 API 미연결)';
      const cards = [
        ['판정기 규칙', `서버 코드 확인: ${data.rules.count}개 · ${data.rules.names.join(', ')}. 실제 판정 실행 기록: ${missing}`],
        ['탐지 사건', `운영 사건 수: ${data.detection.eventCount ?? missing}`],
        ['회수 상태', `제안: ${data.revocation.proposedCount ?? missing} · 완료: ${data.revocation.completedCount ?? missing}`],
        ['복구 버전', `현재: ${data.recovery.currentVersion ?? missing} · 복원: ${data.recovery.restoredVersion ?? missing}`],
      ];
      for (const [title, value] of cards) {
        const item = document.createElement('li');
        const heading = document.createElement('strong');
        const detail = document.createElement('span');
        heading.textContent = title; detail.textContent = value;
        item.append(heading, detail); list.append(item);
      }
      for (const row of data.verification.rows) {
        const tr = document.createElement('tr');
        for (const value of [row.id, row.kind === 'normal' ? '정상' : '금지', row.request,
          row.expected, '미실행', '미확인', '미확인', '미실행']) {
          const td = document.createElement('td'); td.textContent = value; tr.append(td);
        }
        verificationRows.append(tr);
      }
      verificationStatus.textContent = `총 ${data.verification.total}종 · 실측 ${data.verification.measured} · 통과 ${data.verification.passed}. 실제 API 결과 수집 미연결 · 심판 항목 대응 미확인`;
      message.textContent = `API 응답 확인 · ${data.at} · 서버 기록 번호 ${data.recordId}. 같은 번호의 operations_summary 기록과 대조하세요. 미확인을 0건이나 완료로 집계하지 않습니다.`;
    } catch {
      if (version === generation) {
        list.replaceChildren();
        verificationRows.replaceChildren();
        verificationStatus.textContent = '시험 기록 확인 불가';
        message.textContent = '조회 실패 · 확인 불가. 이전 수치를 표시하지 않습니다.';
      }
    } finally { button.disabled = false; }
  }
  button.addEventListener('click', refresh);
  clear();
  return { clear, refresh };
}
