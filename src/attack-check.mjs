// The student changes this check as each stage adds an attack to the same app.
// Never return tokens, private keys, real names, or note bodies.
export async function runAttackChecks(config) {
  let app;
  try {
    app = new URL(config.publicAppUrl);
  } catch {
    throw new Error('aleph.config.json의 실제 배포 주소를 먼저 넣어 주세요.');
  }
  if (app.protocol !== 'https:' || app.username || app.password || app.search || app.hash
      || app.pathname !== '/' || app.hostname.endsWith('.example')) {
    throw new Error('aleph.config.json의 실제 배포 주소를 먼저 넣어 주세요.');
  }
  if (typeof config.sampleMarker !== 'string' || !config.sampleMarker) throw new Error('가상 메모의 확인 표시를 넣어 주세요.');
  if (config.step === 3) {
    const attempts = [];
    const cases = [
      ['anonymous_list', 'GET', '/api/learning-notes'],
      ['anonymous_create', 'POST', '/api/learning-notes'],
      ['anonymous_read', 'GET', '/api/learning-notes/00000000-0000-4000-8000-000000000001'],
      ['anonymous_update', 'PUT', '/api/learning-notes/00000000-0000-4000-8000-000000000001'],
      ['anonymous_delete', 'DELETE', '/api/learning-notes/00000000-0000-4000-8000-000000000001'],
      ['invalid_token', 'GET', '/api/learning-notes'],
    ];
    for (const [attackId, method, path] of cases) {
      try {
        const result = await fetch(new URL(`${path}?userId=untrusted&role=admin`, app), {
          method, redirect: 'error', signal: AbortSignal.timeout(10000),
          headers: { ...(attackId === 'invalid_token' ? { Authorization: 'Bearer invalid' } : {}),
            'Content-Type': 'application/json' },
          ...(['POST', 'PUT'].includes(method) ? { body: JSON.stringify({ title: 'Synthetic check', body: 'Synthetic check' }) } : {}),
        });
        const data = await result.json().catch(() => null);
        const rejected = result.status === 401 && data?.error === 'LOGIN_REQUIRED'
          && Object.keys(data).length === 1;
        attempts.push({ attackId, expected: '401 LOGIN_REQUIRED, 자료 없음, 브라우저 userId·role 무시',
          observed: `HTTP ${result.status} · ${rejected ? '자료 없이 거부 확인' : '예상한 거부 결과와 다름'}` });
      } catch {
        attempts.push({ attackId, expected: '401 LOGIN_REQUIRED, 자료 없음', observed: '요청 실패: 응답 확인 불가' });
      }
    }
    const staticData = await fetch(new URL('/data.json', app), { redirect: 'error', signal: AbortSignal.timeout(10000) });
    const data = await staticData.json().catch(() => null);
    attempts.push({ attackId: 'public_static_notes', expected: '공개 가상 메모는 정적 JSON에서 제외, notes 빈 배열',
      observed: `HTTP ${staticData.status} · ${Array.isArray(data?.notes) && data.notes.length === 0 ? '빈 메모 배열 확인' : '빈 메모 배열 확인 실패'}` });
    attempts.push({ attackId: 'authenticated_crud', expected: '정상 A 추가·수정·삭제 성공, 삭제 후 GET 404',
      observed: '배포 API의 정상 로그인 CRUD 자기 점검은 미실행. 로컬 가상 요청 테스트만 통과.' });
    return attempts;
  }
  if (config.step !== 1) throw new Error('이 단계의 공격 점검을 src/attack-check.mjs에 구현해 주세요.');
  const response = await fetch(new URL('/data.json', app), {
    redirect: 'error', signal: AbortSignal.timeout(10000),
  });
  let visible = false;
  if (response.ok) {
    try {
      const data = await response.json();
      visible = data?.sampleMarker === config.sampleMarker && Array.isArray(data.notes)
        && data.notes.length > 0;
    } catch {
      // A non-JSON response is a failed check, not a successful deployment.
    }
  }
  return [{ attackId: 'anonymous_note_read', expected: '비로그인 화면에서 가상 메모를 확인',
    observed: visible ? '비로그인 요청에서 공개 가상 메모 확인 표시가 보임' : `비로그인 요청에서 확인 표시가 보이지 않음 (HTTP ${response.status})` }];
}
