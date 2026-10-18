// Local checklist derived from the repository, not the judge's unpublished answer key.
const groups = [
  [1, [
    ['normal', '자료실 첫 화면 GET', '200, 공개 화면 접근'],
    ['normal', '공개 data.json GET', '200, notes 빈 배열'],
    ['forbidden', '로그아웃 상태의 비공개 자료 조회', '401, 메모 본문 없음'],
  ]],
  [2, [
    ['normal', '공식 로그인 API 정상 로그인', '200, 세션 확인; 응답에 토큰 없음'],
    ['normal', '로그아웃 후 세션 조회', '로그아웃 200, 세션 signedIn=false'],
    ['forbidden', '잘못된 로그인', '로그인 거부, 자료 반환 없음'],
    ['forbidden', '잘못된 토큰으로 메모 조회', '401 LOGIN_REQUIRED, 자료 없음'],
  ]],
  [3, [
    ['normal', '승인된 B의 임시 메모 추가', '201, 새 UUID 반환'],
    ['normal', 'B 임시 메모 개별 조회', '200, 생성한 메모와 일치 여부만 확인'],
    ['normal', 'B 임시 메모 수정', '200, 변경 일치 여부만 확인'],
    ['normal', 'B 임시 메모 삭제', '200, 지정 임시 메모만 삭제'],
    ['forbidden', '삭제한 B 임시 메모 재조회', '404 NOTE_NOT_FOUND'],
    ['forbidden', '무로그인 메모 추가', '401, 생성 안 됨'],
  ]],
  [4, [
    ['normal', '승인된 A의 기존 본인 메모 조회', '200, 기존 자료 보존'],
    ['forbidden', '승인된 B의 A 메모 조회', '404 NOTE_NOT_FOUND'],
    ['forbidden', 'B의 A 메모 수정 시도', '404, 별도 승인된 폐기용 시험 메모만 사용'],
    ['forbidden', 'B의 A 메모 삭제 시도', '404, 별도 승인된 폐기용 시험 메모만 사용'],
    ['forbidden', 'B 임시 메모의 owner_id 변경', '400 OWNER_CHANGE_NOT_ALLOWED, 소유자 보존'],
  ]],
  [5, [
    ['normal', '승인된 B의 서버 중계 메모 목록 조회', '200, 본인 배열; 브라우저 직접 DB 호출 없음'],
    ['forbidden', '원본 REST API 무인증 조회', '401 또는 403, 자료 없음'],
    ['forbidden', '사용자 역할의 원본 REST 직접 요청', '직접 CRUD 권한 거부; 안전한 공식 점검 경로 없으면 미실행'],
  ]],
  [6, [
    ['normal', '엔진이 확인한 등록 기기의 허용 구역 요청', 'allow, 엔진 응답 requestId 일치'],
    ['forbidden', '엔진의 미등록 기기 요청', 'deny, device_not_registered'],
  ]],
  [7, [
    ['normal', '정상 접속', 'allow'],
    ['forbidden', '복합 의심 요청의 확인 전 접근', 'step_up, 확인 전 자료 접근 없음'],
    ['normal', '같은 주체의 실제 추가 확인 이후 재요청', '새 로그인 확인 후 재판정; 연결 없으면 미실행'],
  ]],
  [8, [
    ['normal', '판정기 경유 개별 메모 GET', 'allow, 본인 API 200도 별도 확인'],
    ['normal', '판정기의 공지 GET', 'allow; 현재 실제 공지 저장소 501은 정상 자료 성공이 아님'],
    ['forbidden', '판정기 경유 전체 메모 목록 요청', 'deny, resource_not_allowed'],
    ['forbidden', '일반 계정의 강사 자료 직접 요청', '403 INSTRUCTOR_REQUIRED'],
  ]],
  [9, [
    ['normal', '정상 조회 사건 전달', 'observe, 회수 제안 없음'],
    ['normal', '동일 주체의 10분 내 GET 정확히 120건', 'observe'],
    ['forbidden', '동일 주체의 10분 내 GET 121건', 'propose_revocation, burst_read; 집행과 별개'],
    ['forbidden', '회수 집행 후 대상 기기의 재접속', '운영 엔진에서 실제 거부; 연결·영수증 없으면 미실행'],
  ]],
  [10, [
    ['normal', '검증한 시험 정책 안전 사본 미리보기', '검증된 버전·차이 확인; 운영 정책 변경 없음'],
    ['forbidden', '사본 검증 또는 확인 코드가 없는 복원', '변경 전 거부; 기존 정책 보존'],
    ['normal', '승인된 B의 지정 가상 메모 한 건 복원', '200, verification 세 값 true; 본문 기록 안 함'],
    ['forbidden', 'A의 B 지정 복원 요청', '403, 변경 없음'],
  ]],
  [11, [
    ['normal', '관리자 승인 후 동일 접속의 자료 요청', '승인 조회 approved, 본인 메모 200'],
    ['forbidden', '설치·승인 요청만 한 미승인 접속', '403, 보호 화면 잠금'],
    ['forbidden', '철회·만료·오프라인 접속', '철회·만료 API 403, 오프라인 자료 표시·재전송 없음'],
  ]],
];

export const VERIFICATION_PLAN = groups.flatMap(([step, rows]) => rows.map(([kind, request, expected], index) => ({
  id: `S${String(step).padStart(2, '0')}-${index + 1}`, step, kind, request, expected,
})));

export function unexecutedVerification() {
  return { source: 'repository_checklist', judgeMapping: 'unconfirmed',
    total: VERIFICATION_PLAN.length, measured: 0, passed: 0,
    rows: VERIFICATION_PLAN.map(row => ({ ...row, status: 'not_run', actual: null,
      requestId: null, checkedAt: null, evidence: null })) };
}
