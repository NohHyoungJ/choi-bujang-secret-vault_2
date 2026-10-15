# 시험 사이트의 접속 승인

이번 사이트 안에 실제로 구현한 서버 경로입니다. 외부 운영 엔진의 주소를 추정해 사용하지 않습니다.

## 범위

서버가 Supabase Auth로 검증한 `sub`와 `session_id` 한 쌍을 **가상 기기**로 취급합니다.
동일 계정이라도 새 로그인 세션에는 승인이 이어지지 않습니다. 물리 기기 식별·기기 키 보유
증명·운영 ALEPH 엔진 연동을 구현한 것은 아닙니다. 세션 탈취에 대한 물리 기기 증명도 제공하지 않습니다.

브라우저는 ID·역할·승인 여부를 보내지 않습니다. 기존 로그인용 HttpOnly·Secure·SameSite 쿠키를
서버가 읽으며, 기기 키·승인 토큰·추가 기기 쿠키를 만들지 않습니다.
localStorage·sessionStorage·IndexedDB에는 인증 또는 승인 정보를 저장하지 않습니다.

## 구현된 경로

| 메서드·경로 | 동작 |
|---|---|
| `POST /api/device-approval` | 본문 `{}`. 현재 검증된 세션의 대기 요청 생성. 이미 있는 승인·철회 상태를 덮어쓰지 않음 |
| `GET /api/device-approval` | 현재 검증된 세션의 승인 상태 조회 |

동일 출처 요청이며 `X-Vault-Request: 1`을 보냅니다. POST는 실제 앱 출처 Origin을 요구합니다.
userId·sessionId·role·approved 등 본문 항목을 추가하면 400입니다.
응답에는 `schema: "vault.test-device-approval.v1"`, `mode: "test_session"`,
`status`, `deviceRegistered`, `requestId`만 있습니다. requestId는 관리자가 확인할 공개 요청 번호이며
토큰·사용자 ID·세션 ID·메모 내용은 응답하지 않습니다.

status는 unregistered·pending·approved·revoked·expired 중 하나입니다.
서버 저장소에서 approved이고 승인 기한이 남아 있을 때만 deviceRegistered가 true입니다.
조회 실패·잘못된 설정·세션 정보 없음은 503, 로그인 실패는 401입니다.
브라우저는 오류·알 수 없는 응답·오프라인에서 자료 영역을 비우고 잠급니다.
POST 응답만으로 자료를 열지 않고 GET으로 서버 상태를 다시 확인합니다.

## 서버 저장소와 승인 절차

`vault_test_device_approvals` 테이블을 연결된 시험 DB에 추가했습니다.
`docs/device-approval-schema.sql`은 적용한 DDL 기록입니다. 기존 메모·권한·감사 데이터는 변경하지 않습니다.
RLS를 켜고 공개 역할과 일반 로그인 역할의 직접 권한을 제거했습니다. 공개 RLS 정책은 만들지 않습니다.
서버 역할에는 조회와 user_id·session_id 열의 INSERT만 허용합니다.
state 입력·UPDATE 권한이 없어 서버의 요청 버튼 처리도 승인 상태를 만들 수 없습니다.

1. 사이트에서 로그인 → **기기 승인 요청**. 화면에 **승인 대기**와 요청 번호가 나와야 합니다.
2. 관리자가 Supabase **Table Editor → vault_test_device_approvals**에서 그 요청 번호를 찾습니다.
   본인에게 승인할 시험 접속인지 확인한 뒤 **state = approved**, **approved_until = 미래 UTC 시각**을 설정합니다.
   요청 번호가 다른 행이나 다른 접속을 일괄 승인하지 않습니다. 이 작업은 앱의 요청 버튼으로 할 수 없습니다.
3. 사이트에서 **승인 결과 다시 확인**. 서버가 approved를 조회한 경우에만 기존 자료실을 엽니다.
4. 철회는 관리자가 해당 행의 state를 revoked로 변경합니다. 다음 상태 확인·자료 요청부터 거부합니다.
   새로고침·focus·재연결 때도 서버를 다시 확인합니다. 이미 화면에 보낸 자료의 원격 삭제를 보장하지 않습니다.

승인 행은 실제 Auth 세션을 참조하며 세션이 삭제되면 함께 삭제됩니다. 기한 만료는 서버 시각으로 검사합니다.
서버의 `learning-notes` 및 그 별칭·공지·강사 경로와 복원 API에서도 매번 같은 승인을 조회합니다.
미승인은 403 DEVICE_NOT_REGISTERED, 조회 실패는 503 DEVICE_APPROVAL_UNAVAILABLE이며 자료는 반환하지 않습니다.
승인 후에도 기존 로그인·소유자·강사 권한 검사는 유지됩니다. 판정기 규칙·엔진 요청 계약은 바꾸지 않습니다.
외부 심판 토큰에는 이 시험용 Auth 세션 승인이 자동 부여되지 않습니다.

## 확인 범위

DB 테이블 생성과 권한 메타데이터 조회는 실행했습니다. 일반 역할의 읽기·수정,
서버 역할의 승인 상태 INSERT·UPDATE 권한이 없고 대기 요청용 INSERT만 가능한 것을 확인했습니다.
실제 계정의 로그인·요청 생성·관리자 승인·승인 후 CRUD·철회 브라우저 시험은 **미실행**입니다.
기존 소유자·복원 모의 검사의 입력은 승인된 가상 상태를 명시하도록 갱신했으며 이번에는 실행하지 않았습니다.
자동 검사 재실행 명령은 `node --test test/pwa.test.mjs test/api-resource-access.test.mjs test/restore-note.test.mjs`입니다.
이 명령은 실제 DB 승인·브라우저 동작이나 심판 통과를 입증하지 않습니다.

실제 화면의 기대 결과: 대기·철회·만료·오류는 자료 없음. 관리자가 승인한 동일 세션은 본인 자료 허용.
승인된 B가 A의 메모를 요청하면 기존 소유자 검사로 404, 미승인 B는 자료 검사 전에 403이어야 합니다.

참고: [Supabase 세션과 session_id](https://supabase.com/docs/guides/auth/sessions).
