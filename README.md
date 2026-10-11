# BYTE BACK 자료실 · 5단계 저장점

처음 확인한 로그인 자료실은 2단계, 메모 CRUD 추가는 3단계이며, 4단계에서 API 소유자 검사·RLS를 추가했고, 이번 5단계에서는 브라우저 자료 호출이 서버 함수를 통하는지 확인하고 원본 DB 직접 권한을 회수했습니다.

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
- AI·침해 정보 API는 501 시작 틀이며, 판정기는 starter.deny만 구현하고 탐지기는 관찰만 합니다.

## 다시 실행하고 확인하기

Node.js 22 이상에서 npm install 후 `node --test test/learning-notes-auth.test.mjs`와 `npm run build -- --local`을 실행합니다. 로컬 정적 빌드만으로 서버 API·실제 DB 연결이 검증되지는 않습니다.

배포 자료실: https://choi-bujang-secret-vault2.vercel.app/

화면에서 로그인 → 제목·내용 입력 → 저장 → 수정·삭제를 누릅니다. 정상 A/B는 본인 CRUD가 가능해야 하고, 상대 UUID 열기는 404여야 합니다. 무로그인·잘못된 토큰은 401, 소유자 변경 PUT은 400, 삭제한 UUID 조회는 404여야 합니다.

Vercel 서버 환경 변수 SUPABASE_URL과 SUPABASE_SECRET_KEY는 공식 Settings → Environment Variables에서만 관리합니다. 비밀번호·JWT·서버 키·실제 개인정보를 코드나 제출 묶음에 넣지 않습니다.

UUID 컬럼 마이그레이션 `supabase/migrations/202610120001_notes_uuid.sql`은 연결된 DB에 적용했습니다. 기존 메모 본문은 저장소에 포함하지 않습니다.

## 설정과 검증 범위

aleph.config.json은 step 5, 실제 GitHub·배포 주소, Supabase issuer/JWKS/audience, GET·POST·PUT·DELETE 경로를 기록합니다. originalApiUrl은 쿼리 없는 https://eqfkncijzfsatalbhmij.supabase.co/rest/v1/learning_notes 입니다. judgeIssuer는 운영 측 주소를 그대로 보존했습니다. RULE_IDS는 실제 기본 거부 동작 starter.deny만 유지합니다.

사용자는 A의 기존 네 메모·B 시험 메모 목록 분리, 실제 A 임시 메모 추가·조회·수정·삭제와 B의 A UUID 조회 404를 확인했습니다. SQL 결과 화면에서 anon 권한 전체 false, authenticated CRUD만 true 및 소유자 정책 4개를 확인했습니다. 실제 상대 메모 수정·삭제 거부와 소유자 변경 거부는 로컬 가상 요청 테스트 통과이며, 도구의 인증된 배포 CRUD·교차 접근 자기 점검과 사용자 역할의 직접 DB RLS 시험은 미실행입니다.

현재 서버 API는 비밀키로 DB에 접근하여 RLS를 우회하므로 앱의 소유자 검사가 계속 필요합니다. 앱 시험 결과를 직접 DB RLS 동작 검증으로 보고하지 않습니다. 무로그인·잘못된 토큰 거부와 정적 메모 부재는 `npm run bundle`에서 실제 요청해 기록합니다. 이는 학생 자기 점검이며 심판 판정이 아닙니다.

`npm run bundle`은 깨끗한 커밋과 로컬 bundle-notes.json이 필요하며 artifacts/submission.json을 생성합니다. 두 JSON 파일은 커밋하지 않습니다. 새 배포 후 결과를 다시 생성할 수 있습니다. GitHub main 푸시는 연결된 Vercel Production 빌드를 시작합니다.

5단계 확인: 사용자는 직접 권한 회수 후에도 A의 본인 CRUD 성공과 상대 UUID 조회 404를 확인했습니다. 도구도 has_table_privilege의 8개 테이블 권한을 읽기 전용 조회하여 anon·authenticated 모두 권한이 없음을 확인했습니다. 브라우저의 Supabase 사용은 Auth에 한정되며 메모 CRUD는 서버 함수만 호출합니다. 서버 전용 설정과 API 소유자 검사는 유지됩니다. 사용자 JWT로 원본 REST API에 직접 요청하는 시험은 미실행입니다. 원본의 무인증 요청 거부는 JWT를 사용한 직접 접근 차단의 증거로 간주하지 않습니다.

## 보너스 xdr-01 저장점

무차별 로그인 가상 경보를 다루는 xdr/brute-force 모듈을 추가했습니다. read-alerts.mjs는 다섯 필드만 추출하고 비밀값처럼 보이는 내용을 숨깁니다. patterns.json의 MITRE T1110·T1110.003 두 패턴을 decide.mjs 내부 상수로 복사했으며, 판정기는 외부 파일·패키지·네트워크 없이 계산합니다.

재실행: `npm run xdr:run -- brute-force`. 갱신된 result.json은 block 10건·alert 9건·record 9건입니다. 원본 설명상 정상 이벤트 bf-20~bf-28은 모두 record이며 오차단이 없었습니다. 이는 가상 경보 자기 점검이고 실제 차단이나 심판 판정이 아닙니다. 화면 조작은 없으며 터미널 결과 파일을 확인합니다.

respond.mjs는 만료 시각·경보 번호가 있는 후보를 deny-candidates.json에 기록하고 알림을 xdr/alerts.log에 한 줄씩 누적합니다. 정상·알림 대상, 만료 경보, 검증되지 않은 공격 기기는 규칙 등록에서 제외합니다. 실제 ZTNA 운영 어댑터와 검증된 공격 기기 연결은 없으므로 실제 규칙을 등록하지 않았습니다. 기존 src/decider.mjs와 가상 경보 원본은 보존했습니다.

본 저장점은 보너스 추가이며 aleph.config.json의 본 과정 단계는 5를 유지합니다. 실제 배포 주소·발급자·허용 경로 8개·원본 API 주소를 구현과 대조했고 judgeIssuer는 보존했습니다. RULE_IDS는 실제 기본 거부 규칙 starter.deny만 유지합니다.

## 보너스 xdr-02 저장점

웹 주입 가상 경보용 xdr/web-injection 모듈을 추가했습니다. read-alerts.mjs는 다섯 필드만 추출하고 비밀값처럼 보이는 값은 숨깁니다. patterns.json의 SQL 주입·스크립트 태그 삽입·반복 경로 탐색 패턴을 decide.mjs 맨 위 상수로 복사했습니다. decide(alert)는 외부 파일·패키지·통신 없이 판단 결과만 반환하며 0.85 이상 block, 0.5 이상 alert, 그 아래 record입니다.

재실행: `npm run xdr:run -- web-injection`. result.json은 block 7건·alert 0건·record 19건입니다. 원본 설명상 정상 이벤트 wi-18~wi-26은 모두 record이며 정상 차단은 0건입니다. 명령 구분자만 있는 wi-06은 현재 세 패턴에 해당하지 않아 record입니다. 이는 학습용 경보의 로컬 자기 점검이며 실제 차단이나 심판 판정이 아닙니다. 화면 조작 없이 결과 파일을 확인합니다.

respond.mjs는 차단 후보에 5분 만료 시각과 근거 경보 번호를 붙이고, 검증된 공격 기기 및 등록된 이유 코드가 있을 때만 운영 연결 함수로 거부 규칙을 전달합니다. 알림은 xdr/alerts.log에 안전한 JSON 한 줄씩 기록합니다. 정상 이벤트·만료 경보·미확인 기기는 등록에서 제외하는 모의 연결 검증을 통과했습니다. 실제 운영 어댑터가 없어 실제 규칙 등록은 미실행이며, 이번 result 생성은 respond.mjs를 실행하지 않습니다. 기존 판정기와 경보 원본은 보존했습니다.

설정의 본 과정 단계 5·기존 배포 주소·발급자·허용 경로 8개·원본 API 주소와 RULE_IDS의 starter.deny를 유지했습니다. 이번 저장점에서 앱 배포나 DB 변경은 실행하지 않았습니다.
