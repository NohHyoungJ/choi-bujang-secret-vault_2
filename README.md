# BYTE BACK 자료실 · 3단계 저장점

처음 확인한 로그인 자료실은 2단계 상태이며, 이번 저장점은 로그인 사용자 메모 CRUD를 추가한 3단계입니다.

## 현재 기능

- Supabase 공식 SDK 이메일·비밀번호 로그인·로그아웃과 실패 이유 표시.
- 자료 API는 기존 `src/verify-login.mjs`로 토큰을 검증하며 브라우저의 userId·role을 신뢰하지 않습니다.
- 목록 GET은 검증된 사용자의 메모 배열을 반환합니다. 새 메모의 owner_id는 서버가 확인한 사용자 ID입니다.
- POST /api/learning-notes: {id?,title,body}, id는 UUID이며 생략하면 서버가 생성해 {id}를 반환합니다.
- GET·PUT·DELETE /api/learning-notes/:id. 단건 GET은 {id,title,body}, 삭제 뒤 GET은 404입니다.
- 개별 조회·수정·삭제의 소유자 검사는 아직 없습니다. B가 A의 UUID로 수정·삭제할 수 있으며 4단계에서 보완할 대상입니다.
- 기존 가상 메모 4개와 숫자 기본키를 보존하고, API용 UUID note_id 컬럼을 추가했습니다. 본인 소유가 아닌 기존 메모는 본인 목록에 나오지 않습니다.
- 공개 data.json에는 notes 빈 배열만 있습니다. 빌드는 메모 본문이 들어 있는 정적 JSON을 거부합니다.
- AI·침해 정보 API는 501 시작 틀이며, 판정기는 starter.deny만 구현하고 탐지기는 관찰만 합니다.

## 다시 실행하고 확인하기

Node.js 22 이상에서 npm install 후 `node --test test/learning-notes-auth.test.mjs`와 `npm run build -- --local`을 실행합니다. 로컬 정적 빌드만으로 서버 API·실제 DB 연결이 검증되지는 않습니다.

배포 자료실: https://choi-bujang-secret-vault2.vercel.app/

화면에서 로그인 → 제목·내용 입력 → 저장 → 수정·삭제를 누릅니다. 정상 A는 CRUD가 가능해야 하고, 무로그인·잘못된 토큰 요청은 자료 없이 401이어야 하며, 삭제한 UUID 조회는 404여야 합니다.

Vercel 서버 환경 변수 SUPABASE_URL과 SUPABASE_SECRET_KEY는 공식 Settings → Environment Variables에서만 관리합니다. 비밀번호·JWT·서버 키·실제 개인정보를 코드나 제출 묶음에 넣지 않습니다.

UUID 컬럼 마이그레이션 `supabase/migrations/202610120001_notes_uuid.sql`은 연결된 DB에 적용했습니다. 기존 메모 본문은 저장소에 포함하지 않습니다.

## 설정과 검증 범위

aleph.config.json은 step 3, 실제 GitHub·배포 주소, Supabase issuer/JWKS/audience, GET·POST·PUT·DELETE 경로를 기록합니다. originalApiUrl은 5단계 이전이므로 null입니다. judgeIssuer는 운영 측 주소를 그대로 보존했습니다.

실제 배포에서 A 로그인과 기존 자료 4개 표시는 사용자가 확인했습니다. CRUD는 로컬 가상 요청 테스트 통과이며, 실제 A 계정의 CRUD 자기 점검은 미실행입니다. 무로그인·잘못된 토큰의 실제 API 거부와 정적 메모 부재는 `npm run bundle`의 src/attack-check.mjs에서 다시 요청해 기록합니다. 이는 학생 자기 점검이며 심판 판정이 아닙니다.

`npm run bundle`은 깨끗한 커밋과 로컬 bundle-notes.json이 필요하며 artifacts/submission.json을 생성합니다. 두 JSON 파일은 커밋하지 않습니다. 새 배포 후 결과를 다시 생성할 수 있습니다. GitHub main 푸시는 연결된 Vercel Production 빌드를 시작합니다.
