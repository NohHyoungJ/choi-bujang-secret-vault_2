# BYTE BACK 자료실 · 9단계 저장점

로그인 자료실과 메모 CRUD에 API 소유자 검사·RLS·원본 DB 직접 권한 회수를 추가했습니다. 6~7단계의 기기·가상 추가 확인 규칙에 이어, 8단계에서는 자료 구역 규칙과 API의 저장된 권한 재확인을 구현했습니다.

## 현재 기능

- Supabase 공식 SDK 이메일·비밀번호 로그인·로그아웃은 서버의 /api/session에서 처리하고 실패 이유를 화면에 표시합니다. 브라우저 코드에는 Supabase 공개 키·SDK·JWT가 없으며 HttpOnly·Secure·SameSite=Strict 쿠키로 서버에 인증합니다.
- 자료 API는 기존 `src/verify-login.mjs`로 토큰을 검증하며 브라우저의 userId·role을 신뢰하지 않습니다.
- 목록 GET은 검증된 사용자의 메모 배열을 반환합니다. 새 메모의 owner_id는 서버가 확인한 사용자 ID입니다.
- POST /api/learning-notes: {id?,title,body}, id는 UUID이며 생략하면 서버가 생성해 {id}를 반환합니다.
- GET·PUT·DELETE /api/learning-notes/:id. 단건 GET은 {id,title,body}, 삭제 뒤 GET은 404입니다.
- 개별 조회·수정·삭제는 검증된 사용자 ID와 owner_id를 같은 DB 요청에서 비교합니다. 상대 메모는 404이며, 수정 본문에 owner_id가 있으면 400으로 거부합니다. 수정 전후 소유자는 본인으로 유지됩니다.
- 학습 DB의 RLS 정책은 authenticated의 SELECT·DELETE에 USING, INSERT에 WITH CHECK, UPDATE에 둘 다 auth.uid() = owner_id를 적용합니다. 4단계에서는 authenticated CRUD를 허용했으나 5단계에서는 PUBLIC·anon·authenticated의 메모 테이블 직접 권한을 회수했습니다. RLS 정책은 보존했습니다.
- 기존 가상 메모 4개와 숫자 기본키를 보존하고, API용 UUID note_id 컬럼을 추가했습니다. 본인 소유가 아닌 기존 메모는 본인 목록에 나오지 않습니다.
- 공개 data.json에는 notes 빈 배열만 있습니다. 빌드는 메모 본문이 들어 있는 정적 JSON을 거부합니다.
- AI·침해 정보 API는 501 시작 틀이며, 판정기는 `device_registered`, `step_up_required`, `resource_scope` 규칙을 구현합니다. 탐지기는 로컬 가상 복합 의심을 표시하고 확인된 가상 기기 한 개의 회수 제안만 반환합니다. 실제 재인증·기기 회수 연결은 미실행입니다.

## 다시 실행하고 확인하기

Node.js 22 이상에서 npm install 후 `node --test test/learning-notes-auth.test.mjs`와 `npm run build -- --local`을 실행합니다. 로컬 정적 빌드만으로 서버 API·실제 DB 연결이 검증되지는 않습니다.

## 6단계 판정기 확인 순서

터미널에서 `npm run decider:test`를 실행합니다. 출력에서 `등록 기기의 정상 요청`과 `미등록 기기의 가상 요청`이 각각 `통과`인지 확인합니다. 정상 등록 요청은 `allow`, 미등록 또는 등록 값이 없는 요청은 `deny`와 `device_not_registered`여야 합니다. 이 스크립트는 가상 요청 연습이며 실제 미등록 기기 공격 검증은 심판이 맡습니다.

이번 작업 셸에는 `npm` 명령이 없어 위 명령은 시작되지 않았습니다. 같은 연습 스크립트를 Node.js로 직접 실행한 결과 두 항목 모두 통과했습니다. 출력은 가상 요청 자기 점검이며 심판 판정 증거가 아닙니다.

배포 자료실: https://choi-bujang-secret-vault2.vercel.app/

화면에서 로그인 → 제목·내용 입력 → 저장 → 수정·삭제를 누릅니다. 정상 A/B는 본인 CRUD가 가능해야 하고, 상대 UUID 열기는 404여야 합니다. 무로그인·잘못된 토큰은 401, 소유자 변경 PUT은 400, 삭제한 UUID 조회는 404여야 합니다.

Vercel 서버 환경 변수 SUPABASE_URL과 SUPABASE_SECRET_KEY는 공식 Settings → Environment Variables에서만 관리합니다. 비밀번호·JWT·서버 키·실제 개인정보를 코드나 제출 묶음에 넣지 않습니다.

UUID 컬럼 마이그레이션 `supabase/migrations/202610120001_notes_uuid.sql`은 연결된 DB에 적용했습니다. 기존 메모 본문은 저장소에 포함하지 않습니다.

## 설정과 검증 범위

aleph.config.json은 step 9, 기존 GitHub·배포 주소, Supabase issuer/JWKS/audience, GET·POST·PUT·DELETE 경로를 구현과 대조해 기록합니다. originalApiUrl은 쿼리 없는 https://eqfkncijzfsatalbhmij.supabase.co/rest/v1/learning_notes 입니다. judgeIssuer는 운영 측 주소를 그대로 보존했습니다. 현재 판정기 `RULE_IDS`에는 실제 구현한 `device_registered`, `step_up_required`, `resource_scope`를 기록합니다. 9단계 실제 배포·심판 확인 결과는 아래 검증 범위를 따릅니다.

사용자는 A의 기존 네 메모·B 시험 메모 목록 분리, 실제 A 임시 메모 추가·조회·수정·삭제와 B의 A UUID 조회 404를 확인했습니다. SQL 결과 화면에서 anon 권한 전체 false, authenticated CRUD만 true 및 소유자 정책 4개를 확인했습니다. 실제 상대 메모 수정·삭제 거부와 소유자 변경 거부는 로컬 가상 요청 테스트 통과이며, 도구의 인증된 배포 CRUD·교차 접근 자기 점검과 사용자 역할의 직접 DB RLS 시험은 미실행입니다.

현재 서버 API는 비밀키로 DB에 접근하여 RLS를 우회하므로 앱의 소유자 검사가 계속 필요합니다. 앱 시험 결과를 직접 DB RLS 동작 검증으로 보고하지 않습니다. 무로그인·잘못된 토큰 거부와 정적 메모 부재는 `npm run bundle`에서 실제 요청해 기록합니다. 이는 학생 자기 점검이며 심판 판정이 아닙니다.

`npm run bundle`은 깨끗한 커밋과 로컬 bundle-notes.json이 필요하며 artifacts/submission.json을 생성합니다. 두 JSON 파일은 커밋하지 않습니다. 새 배포 후 결과를 다시 생성할 수 있습니다. GitHub main 푸시는 연결된 Vercel Production 빌드를 시작합니다.

5단계 확인: 사용자는 직접 권한 회수 후에도 A의 본인 CRUD 성공과 상대 UUID 조회 404를 확인했습니다. 도구도 has_table_privilege의 8개 테이블 권한을 읽기 전용 조회하여 anon·authenticated 모두 권한이 없음을 확인했습니다. 브라우저의 Supabase 사용은 Auth에 한정되며 메모 CRUD는 서버 함수만 호출합니다. 서버 전용 설정과 API 소유자 검사는 유지됩니다. 사용자 JWT로 원본 REST API에 직접 요청하는 시험은 미실행입니다. 원본의 무인증 요청 거부는 JWT를 사용한 직접 접근 차단의 증거로 간주하지 않습니다.

## 7단계 저장점: 재로그인 계약 확인과 가상 시험

현재 제공된 `docs/DECIDER_REQUEST.md`의 v1 계약에는 `stepUp.verified`와 `authAgeSeconds`가 있으나, 같은 주체가 추가 확인 요청 이후 새로 로그인했음을 보장하는 계약은 없습니다. 문서는 이 값만으로 재인증 확인 요청을 건너뛰지 말라고 명시합니다. 문서가 참조하는 `student-kit/sdp-core/decision-contract.mjs` 엔진 구현은 이 저장소에 없어 실제 재로그인 처리까지 확인하지 못했습니다.

가상 사건 재실행: `npm run decider:test`. 이번 셸에서는 npm 대신 Node.js로 같은 스크립트를 직접 실행해 네 항목 통과를 확인했습니다. 정상 요청은 `allow`, 복합 이상 사건은 확인 전 `step_up`·`step_up_required`입니다. `judge_fixture` 가상 요청에서 `stepUp.verified`가 true이고 `authAgeSeconds`가 유한한 0~900초이면 재확인 완료로 처리해 `allow`를 반환합니다. 누락·잘못된 값·만료는 추가 확인을 유지하며 미등록 기기는 재확인 여부와 관계없이 `deny`·`device_not_registered`입니다. 가상 재확인 결과는 실제 새 로그인 증거로 취급하지 않습니다. 현재 규칙은 `device_registered`와 `step_up_required`입니다.

실제 자료 차단, 재인증 화면 연결, 같은 사용자 새 로그인 확인 및 이후 요청 재판정은 **미실행**입니다. 이번 확인은 가상 요청 시험이며 실제 심판 판정이 아닙니다. 화면에서 누를 곳은 없으며 터미널 출력을 확인합니다. 토큰 원문은 사용하거나 기록하지 않았습니다. `npm run fixture:7`에 해당하는 스크립트도 직접 실행해 정상 `allow`와 복합 이상 `step_up`을 확인했습니다. 재확인 실패 수정을 커밋한 뒤 심판 화면에서 해당 커밋을 선택해 7단계를 다시 검사합니다. 실제 심판 재검사 결과는 아직 미확인입니다.

## 8단계 저장점: 자료 구역과 API 권한

판정기는 `device_registered`, `step_up_required`, `resource_scope` 세 규칙을 구현합니다. 서비스·메서드·정확한 path·route를 함께 검사합니다. 메모는 개별 ID 경로의 GET·PUT·DELETE만 허용하며 전체 목록·생성·export·쿼리 요청은 거부합니다. 공지는 GET만, 모든 공지 쓰기·강사 자료·알 수 없는 경로는 거부합니다. 메모 소유자 비교는 API에 남겨 두었습니다. 상세 경로 표는 `docs/RESOURCE_IDS.md`에 있습니다.

API는 기존 메모 자료·주소·화면 메뉴를 보존합니다. 메모 DB 소유자 필터에 더해 반환 행의 owner_id를 재대조합니다. 강사 자료와 공지 관리 경로에서는 Auth의 저장된 app_metadata.role이 instructor인지 매 요청마다 서버에서 조회합니다. 사용자 입력의 role이나 user_metadata는 권한으로 쓰지 않습니다. 거부 로그에는 고정 사유 코드만 남깁니다. 공지·강사 자료 저장소와 실제 공지 수정 기능은 미구현이며, 강사 권한을 확인해도 501입니다.

재실행: `node --test test/decider-resource.test.mjs test/api-resource-access.test.mjs`. 제공 Node.js로 실행해 가상 구역 검사와 직접 API 호출 모의 시험이 통과했습니다. `npm run decider:test`에 해당하는 스크립트도 직접 실행해 기존 네 항목 통과를 확인했습니다. 화면 조작 없이 터미널 결과를 확인합니다. 가상 개별 메모·공지 GET은 allow, 메모 목록·공지 쓰기·강사 자료는 deny여야 합니다. API 모의 시험에서 본인 메모 200, 타인 메모 404, 위조 강사 역할 403, 저장된 권한 회수 즉시 거부를 확인했습니다. 실제 계정·토큰·서명 키를 만들거나 사용하지 않았습니다.

aleph.config.json은 step 8이며 allowedRoutes 15개가 판정기의 명시적 허용 조합과 일치하는지 검사했습니다. 자료 API 전체 목록·생성 기능은 보존하지만 판정기 경유 허용 목록에서는 제외합니다. 연습용 경로를 등록하는 것만으로 실제 API가 추가되지는 않습니다. 기존 배포 주소·로그인 발급자·원본 API는 구현과 대조했고 judgeIssuer는 보존했습니다. RULE_IDS에는 구현한 세 규칙만 있습니다. 운영 등록부의 resource_not_allowed 사유 코드와 notices 서비스 이름 일치 여부는 미확인입니다.

`npm run bundle`은 실제 배포 무인증 요청과 로컬 가상 판정 결과를 구분해 기록합니다. 실제 인증 계정의 강사 권한·회수·A/B 교차 접근과 사용자 JWT 원본 DB 시험, 실제 재인증 연결은 미실행입니다. 심판 화면에서는 8단계 저장점 커밋을 선택해 다시 검사합니다. 로컬 시험과 HTTP 자기 점검은 실제 심판 통과 증거가 아닙니다.

## 9단계 저장점: 복합 의심과 가상 기기 회수 제안

제공 사건의 가명 사용자·요청 종류만 안전하게 추출하며 기기·판정이 없으면 null로 남깁니다. 학생이 승인한 로컬 계약 확장으로 judge_fixture 네트워크와 fixtureDevice 확인 정보를 사용합니다. 메모 내용·토큰·실명·지역은 읽거나 출력하지 않습니다. 실제 운영 계약의 확장이나 기기 검증 완료를 의미하지 않습니다.

같은 가명 사용자의 다른 네트워크 GET이 10분 내 120건을 넘을 때만 flag_suspicious로 표시합니다. 정확히 120건, 정상 네트워크, 단일 이상, 시간 밖 조회, 사용자 분리, 출처 누락은 observe입니다. 같은 확인 가상 기기에서 복합 조회가 120건을 넘을 때만 revocationProposal에 propose_revocation·기기 한 개·unusual_network_burst 사유를 넣습니다. 여러 기기의 건수를 합산해 한 기기에 제안하지 않습니다. 기존 접속 판정 응답 다섯 항목은 유지합니다.

재실행: `npm run detect:test`. 이번 셸에 npm이 없어 제공 Node.js로 같은 스크립트를 실행했습니다. 복합 사건 시험 13개와 `node --test test/detect-input.test.mjs test/detect-revocation.test.mjs`의 입력·제안 시험 9개가 통과했습니다. 화면 조작 없이 터미널 결과를 확인합니다. 정상·미확인 기기는 회수 제안이 없어야 하고 확인 가상 기기의 복합 조회에만 한 개 제안이 있어야 합니다.

aleph.config.json은 step 9이며 기존 자료 주소·로그인 발급자·원본 API·판정기 허용 경로 15개를 유지했습니다. judgeIssuer는 보존했고 RULE_IDS에는 기존 세 규칙만 있습니다. 탐지 제안은 접속 판정기의 규칙 등록과 별개입니다. 회수 API·외부 회수 호출·기기 권한 변경·회수 시간 측정은 구현하거나 실행하지 않았습니다. 운영 사건 전달·회수 집행은 미연결이며 실제 회수와 시간은 심판이 확인합니다. 이번 저장점은 아직 푸시·배포하지 않았으므로 배포 HTTP 자기 점검은 기존 배포에 대한 결과입니다.

`npm run bundle`은 실제 배포 무인증 요청, 로컬 가상 탐지·제안, 실제 회수 미실행을 구분해 기록합니다. 실제 심판 통과 결과로 표시하지 않습니다. 원본 API의 사용자 JWT 접근·실제 인증 A/B 교차 접근·강사 계정 시험·재인증 연결도 미실행 상태입니다.

## 보너스 xdr-01 저장점

무차별 로그인 가상 경보를 다루는 xdr/brute-force 모듈을 추가했습니다. read-alerts.mjs는 다섯 필드만 추출하고 비밀값처럼 보이는 내용을 숨깁니다. patterns.json의 MITRE T1110·T1110.003 두 패턴을 decide.mjs 내부 상수로 복사했으며, 판정기는 외부 파일·패키지·네트워크 없이 계산합니다.

재실행: `npm run xdr:run -- brute-force`. 갱신된 result.json은 block 10건·alert 9건·record 9건입니다. 원본 설명상 정상 이벤트 bf-20~bf-28은 모두 record이며 오차단이 없었습니다. 이는 가상 경보 자기 점검이고 실제 차단이나 심판 판정이 아닙니다. 화면 조작은 없으며 터미널 결과 파일을 확인합니다.

respond.mjs는 만료 시각·경보 번호가 있는 후보를 deny-candidates.json에 기록하고 알림을 xdr/alerts.log에 한 줄씩 누적합니다. 정상·알림 대상, 만료 경보, 검증되지 않은 공격 기기는 규칙 등록에서 제외합니다. 실제 ZTNA 운영 어댑터와 검증된 공격 기기 연결은 없으므로 실제 규칙을 등록하지 않았습니다. 기존 src/decider.mjs와 가상 경보 원본은 보존했습니다.

본 저장점은 보너스 추가이며 aleph.config.json의 본 과정 단계는 5를 유지합니다. 실제 배포 주소·발급자·허용 경로 8개·원본 API 주소를 구현과 대조했고 judgeIssuer는 보존했습니다. RULE_IDS는 실제 기본 거부 규칙 starter.deny만 유지합니다.

## 보너스 xdr-02 저장점

웹 주입 가상 경보용 xdr/web-injection 모듈을 추가했습니다. read-alerts.mjs는 다섯 필드만 추출하고 비밀값처럼 보이는 값은 숨깁니다. patterns.json의 SQL 주입·스크립트 태그 삽입·반복 경로 탐색 패턴을 decide.mjs 맨 위 상수로 복사했습니다. decide(alert)는 외부 파일·패키지·통신 없이 판단 결과만 반환하며 0.85 이상 block, 0.5 이상 alert, 그 아래 record입니다.

재실행: `npm run xdr:run -- web-injection`. 명령 구분자 주입과 단발성 의심 신호를 보완한 result.json은 block 8건·alert 9건·record 9건입니다. 원본 설명상 정상 이벤트 wi-18~wi-26은 모두 record이며 정상 차단은 0건입니다. 같은 출발 주소에서 반복되는 명확한 주입은 차단 후보, 중간 수준의 단발성 의심 신호는 알림으로 구분합니다. 이는 학습용 경보의 로컬 자기 점검이며 실제 차단이나 심판 판정이 아닙니다. 화면 조작 없이 결과 파일을 확인합니다.

respond.mjs는 차단 후보에 5분 만료 시각과 근거 경보 번호를 붙이고, 검증된 공격 기기 및 등록된 이유 코드가 있을 때만 운영 연결 함수로 거부 규칙을 전달합니다. 알림은 xdr/alerts.log에 안전한 JSON 한 줄씩 기록합니다. 정상 이벤트·만료 경보·미확인 기기는 등록에서 제외하는 모의 연결 검증을 통과했습니다. 실제 운영 어댑터가 없어 실제 규칙 등록은 미실행이며, 이번 result 생성은 respond.mjs를 실행하지 않습니다. 기존 판정기와 경보 원본은 보존했습니다.

설정의 본 과정 단계 5·기존 배포 주소·발급자·허용 경로 8개·원본 API 주소와 RULE_IDS의 starter.deny를 유지했습니다. 이번 저장점에서 앱 배포나 DB 변경은 실행하지 않았습니다.
