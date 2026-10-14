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
  if ([3, 4, 5, 6, 7, 8, 9].includes(config.step)) {
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
    if (config.step >= 4) {
      attempts.push({ attackId: 'cross_owner_access', expected: '상대 UUID의 GET·PUT·DELETE 404, 소유자 변경 PUT 400',
        observed: '배포 API의 인증된 A/B 교차 접근 자기 점검은 미실행. 로컬 가상 요청 테스트만 통과.' });
      attempts.push({ attackId: 'database_rls', expected: '사용자 역할의 본인 행 CRUD 허용, 상대 행 접근·소유자 변경 거부',
        observed: '사용자 역할로 DB에 직접 접근하는 RLS 동작 자기 점검은 미실행.' });
    }
    if (config.step >= 5) {
      const original = new URL(config.originalApiUrl);
      if (original.protocol !== 'https:' || original.username || original.password || original.search || original.hash) {
        throw new Error('originalApiUrl은 쿼리 없는 원본 HTTPS 자료 경로여야 합니다.');
      }
      try {
        const response = await fetch(original, { redirect: 'error', signal: AbortSignal.timeout(10000) });
        attempts.push({ attackId: 'original_without_credentials', expected: '인증 정보 없는 원본 API 요청 거부',
          observed: `HTTP ${response.status} · ${[401, 403].includes(response.status) ? '거부 응답 확인' : '예상한 거부 상태 아님'}. 이 요청은 DB 역할 권한 시험이 아님.` });
        await response.body?.cancel();
      } catch {
        attempts.push({ attackId: 'original_without_credentials', expected: '인증 정보 없는 원본 API 요청 거부', observed: '요청 실패: 응답 확인 불가' });
      }
      attempts.push({ attackId: 'original_authenticated_access', expected: '사용자 JWT로 원본 메모 API 직접 CRUD 거부',
        observed: '사용자 JWT를 이용한 원본 API 직접 접근 자기 점검은 미실행.' });
    }
    if (config.step === 7) {
      const { fixtureRequests } = await import('../scripts/fixture-7.mjs');
      const { decide } = await import('./decider.mjs');
      const { normal, suspicious } = fixtureRequests();
      for (const [attackId, request, expected] of [
        ['virtual_normal_access', normal, '가상 정상 요청: allow · approved'],
        ['virtual_unusual_access', suspicious, '가상 복합 이상 요청: step_up · step_up_required'],
        ['virtual_unregistered_device', { ...normal, deviceRegistered: false },
          '가상 미등록 기기: deny · device_not_registered'],
        ['virtual_verified_flag', { ...suspicious, stepUp: { verified: true, authAgeSeconds: 60 } },
          '유효한 가상 재확인 완료: allow · approved. 실제 새 로그인 증거 아님.'],
      ]) {
        const result = await decide(request);
        attempts.push({ attackId, expected,
          observed: `로컬 가상 요청 결과: ${result.decision} · ${result.reasonCode}. 실제 접속·심판 판정 아님.` });
      }
      attempts.push({ attackId: 'live_step_up_reauthentication',
        expected: '같은 사용자 새 로그인 확인 전 자료 차단, 새 로그인 후 요청 재판정',
        observed: '미실행. 제공 계약에 추가 확인 이후 같은 사용자 새 로그인을 보장하는 정보가 없으며 실제 재인증 연결도 확인하지 못함.' });
    }
    if (config.step === 8) {
      const { fixtureRequests } = await import('../scripts/fixture-7.mjs');
      const { decide } = await import('./decider.mjs');
      const { normal, suspicious } = fixtureRequests();
      const virtual = (service, method, path, route, extra = {}) => ({
        ...normal, service, method, path, route, ...extra,
      });
      const groups = [
        ['virtual_notes_scope', '가상 개별 메모 allow, 전체 목록·export·쿼리 요청 deny', [normal,
          virtual('notes', 'GET', '/notes', 'GET /notes'),
          virtual('notes', 'GET', '/notes/export', 'GET /notes/:id'),
          { ...normal, queryLength: 12 }]],
        ['virtual_notice_scope', '가상 공지 GET allow, POST·PUT·PATCH·DELETE deny',
          ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(method =>
            virtual('notices', method, '/api/instructor-notices/demo', `${method} /api/instructor-notices/:id`))],
        ['virtual_instructor_scope', '가상 강사 자료·알 수 없는 서비스 deny', [
          virtual('instructor_materials', 'GET', '/api/instructor-materials/demo', 'GET /api/instructor-materials/:id'),
          { ...normal, service: 'unknown' }]],
        ['virtual_previous_rules', '기존 가상 정상 allow·미등록 deny·복합 이상 step_up·재확인 allow', [normal,
          { ...normal, deviceRegistered: false }, suspicious,
          { ...suspicious, stepUp: { verified: true, authAgeSeconds: 60 } }]],
        ['virtual_route_binding', '가상 서비스·route 불일치 deny', [
          { ...normal, service: 'notices' }, { ...normal, route: 'GET /notes' }]],
      ];
      for (const [attackId, expected, requests] of groups) {
        const results = [];
        for (const request of requests) {
          const result = await decide(request);
          results.push(`${result.decision}/${result.reasonCode}`);
        }
        attempts.push({ attackId, expected, observed: `로컬 가상 요청: ${results.join(', ')}. 심판 판정 아님.` });
      }
      for (const [attackId, method, path, expectedStatus] of [
        ['anonymous_instructor_materials', 'GET', '/api/instructor-materials', 401],
        ['direct_notice_write', 'POST', '/api/instructor-notices', 405],
      ]) {
        try {
          const response = await fetch(new URL(path, app), {
            method, redirect: 'error', signal: AbortSignal.timeout(10000),
          });
          attempts.push({ attackId, expected: `직접 API 요청 HTTP ${expectedStatus}, 자료 반환 없음`,
            observed: `HTTP ${response.status} · ${response.status === expectedStatus ? '거부 상태 확인' : '예상한 거부 상태와 다름'}. 인증된 강사 권한 시험 아님.` });
          await response.body?.cancel();
        } catch {
          attempts.push({ attackId, expected: `직접 API 요청 HTTP ${expectedStatus}`, observed: '요청 실패: 응답 확인 불가' });
        }
      }
      attempts.push({ attackId: 'live_instructor_authorization',
        expected: '저장된 강사 권한 재조회, 일반 사용자 403, 강사는 미구현 저장소 501',
        observed: '실제 인증 계정의 강사 경로·권한 회수 시험과 실제 재인증 연결은 미실행. API 권한 분기는 대역을 사용한 로컬 모의 시험만 통과.' });
    }
    if (config.step === 9) {
      const { detect } = await import('./detect.mjs');
      const reads = (count, { network = 'unusual', verified = false, source = 'judge_fixture',
        id = 'a'.repeat(16), subject = 'learner_fixture', interval = 2000 } = {}) =>
        Array.from({ length: count }, (_, index) => ({
          at: new Date(Date.UTC(2026, 9, 1) + index * interval).toISOString(),
          method: 'GET', identity: { sub: subject },
          signals: { source: 'judge_fixture', network }, fixtureDevice: { source, verified, id },
        }));
      const privacy = reads(121, { verified: true });
      for (const event of privacy) {
        for (const name of ['body', 'token', 'realName']) {
          Object.defineProperty(event, name, { get() { throw new Error('unexpected_private_field_read'); } });
        }
      }
      const groups = [
        ['virtual_detection_normal', '정상·단일 이상·120건은 observe, 회수 제안 없음',
          [reads(30, { network: 'usual' }), reads(200, { network: 'usual' }), reads(30), reads(120)]],
        ['virtual_detection_burst', '복합 의심 flag_suspicious; 확인된 가상 기기 한 개만 propose_revocation',
          [reads(121), reads(121, { verified: true })]],
        ['virtual_detection_unverified', '미확인·출처 불명·기기 누락은 의심 표시만, 회수 제안 없음',
          [reads(121), reads(121, { verified: true, source: 'unknown' }),
            reads(121).map(({ fixtureDevice, ...event }) => event)]],
        ['virtual_detection_isolation', '여러 기기의 합산 회수 제안 없음, 사용자 간 사건 합산 없음', [
          [...reads(70, { verified: true }), ...reads(60, { verified: true, id: 'b'.repeat(16) })],
          [...reads(100, { verified: true }), ...reads(100, { verified: true, subject: 'other_fixture' })]]],
        ['virtual_detection_time', '10분 밖으로 흩어진 조회 observe, 회수 제안 없음',
          [reads(200, { verified: true, interval: 7000 })]],
        ['virtual_detection_privacy', '비밀 속성을 읽지 않고 확인된 가상 기기 한 개의 회수 제안', [privacy]],
      ];
      for (const [attackId, expected, inputs] of groups) {
        const results = inputs.map(input => {
          const result = detect(input);
          const proposal = result.revocationProposal;
          return `${result.action}/${proposal?.action ?? '제안없음'}${proposal ? `(가상 기기 1개, ${proposal.reasonCode})` : ''}`;
        });
        attempts.push({ attackId, expected,
          observed: `로컬 가상 사건: ${results.join(', ')}. 실제 회수·심판 판정 아님.` });
      }
      const { fixtureRequests } = await import('../scripts/fixture-7.mjs');
      const { decide } = await import('./decider.mjs');
      const { normal, suspicious } = fixtureRequests();
      const previous = [];
      for (const request of [normal, { ...normal, deviceRegistered: false }, suspicious,
        { ...suspicious, stepUp: { verified: true, authAgeSeconds: 60 } }]) {
        const result = await decide(request);
        previous.push(`${result.decision}/${result.reasonCode}`);
      }
      attempts.push({ attackId: 'virtual_previous_rules', expected: '기존 가상 정상 allow·미등록 deny·복합 이상 step_up·재확인 allow',
        observed: `로컬 가상 요청: ${previous.join(', ')}. 심판 판정 아님.` });
      attempts.push({ attackId: 'live_device_revocation', expected: '실제 사건 전달·기기 한 개의 권한 회수·회수 시간은 심판 확인',
        observed: '미실행. 운영 엔진의 사건 전달·회수 집행은 미연결이며 회수 API·기기 권한 변경·회수 시간 측정을 실행하지 않음. 실제 강사 계정·재인증 연결도 미실행.' });
    }
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
