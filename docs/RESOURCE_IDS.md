# 8단계 자원 식별

서버는 `src/resource-ids.mjs`의 `resourceForPath(pathname)`으로 경로를 분류합니다.
각 자료 요청에서 분류한 `resourceId`를 사용하며 응답의 `X-Resource-Id` 헤더로 표시합니다.
사용자가 보낸 쿼리·본문·헤더의 자원 ID는 분류에 사용하지 않습니다.

| 자원 | 자원 ID | 경로 |
|---|---|---|
| 내 자료실 메모 | `personal_notes` | 기존 `/api/learning-notes`, `/api/learning-notes/:id` |
| 강사 공지 | `instructor_notices` | `/api/instructor-notices`, `/api/instructor-notices/:id` |

자원 ID는 자료 구역을 나타내며, 기존 메모 UUID는 개별 자료 ID로 보존합니다.
메모 응답 JSON·CRUD·소유자 검사는 그대로 사용합니다. 화면 메뉴는 변경하지 않습니다.
공지 저장소는 아직 없으므로, 공지 API는 로그인 검증 후 501
`INSTRUCTOR_NOTICES_NOT_CONFIGURED`를 반환합니다. 공지 요청으로 메모를 읽지 않습니다.
무로그인 GET 요청은 두 자원 모두 401 `LOGIN_REQUIRED`입니다.
알 수 없는 경로는 자원을 추측하지 않고 404 `NOT_FOUND`입니다.

판정기 v1 입력에는 `resourceId`가 없으므로 판정 요청에 새 필드를 추가하지 않습니다.
판정기는 `service`·`method`·`path`·`route`를 함께 비교하는 `resource_scope` 규칙을 사용합니다.
등록되지 않은 기기는 먼저 거부하고, 구역에서 허용한 요청에 기존 추가 확인 규칙을 적용합니다.

| 판정기 서비스 | 허용 경로 모양 | 허용 메서드 |
|---|---|---|
| `notes` | `/api/learning-notes/:id`, `/api/notes/:id`, `/notes/:id` | GET, PUT, DELETE |
| `notices` | `/api/instructor-notices`, `/api/notices`, `/notices` 및 각 경로의 `/:id` | GET |
| 그 밖의 서비스(강사 자료 포함) | 없음 | 없음 |

각 경로는 별도로 명시한 일치 항목이며 접두사만으로 허용하지 않습니다.
`route`도 메서드를 포함해 정확히 일치해야 합니다. 메모 ID는 UUID로 제한하지 않되,
빈 값·중첩 경로·경로 구분자·`export` 기능 경로·점 경로는 거부합니다.
쿼리로 기능을 선택하지 않도록 `queryLength`가 정확히 0인 요청만 검사에 통과합니다.
메모 전체 목록과 생성, 모든 공지 쓰기, 관리 경로, 강사 자료는 판정기에서 거부합니다.
자료별 소유자 비교는 기존 API에 남깁니다. 공지 수정은 서버 관리 경로에서 별도로
검증합니다. 서버 관리 경로의 권한 검사는 아래와 같으며, 실제 공지 저장·수정은 미구현입니다.

`aleph.config.json.allowedRoutes`에는 위 허용 조합만 메서드와 함께 기록했습니다.
`/notes` 계열은 기존 연습 경로이고 `/api/notes`, `/api/notices`, `/notices`는 명시한
판정기 경로입니다. 판정기에 경로를 등록하는 것만으로 실제 API가 추가되지는 않습니다.
현재 실제 API는 기존 메모 경로와 앞서 만든 공지 시작 틀 경로입니다.
로그인 세션 경로는 판정기의 자료 허용 목록에서 제외했습니다.

구역 거부 결과는 `deny`·`resource_not_allowed`입니다. 제공 문서에 운영 등록부의
허용 사유 코드 목록과 공지 서비스 이름 목록이 없어, 이 사유 코드 및 `notices` 서비스가
운영 엔진 설정과 일치하는지는 미확인입니다. 실제 심판 통과로 보고하지 않습니다.

가상 규칙 확인: `node --test test/decider-resource.test.mjs`.
정상 개별 메모와 공지 GET은 allow, 메모 전체 목록·공지 쓰기·강사 자료·알 수 없는
경로는 deny여야 합니다. 실제 화면 조작 없이 터미널 출력을 확인합니다.

배포 후 확인 명령: `curl.exe -i https://choi-bujang-secret-vault2.vercel.app/api/instructor-notices`
무로그인 상태에서는 401과 `X-Resource-Id: instructor_notices`가 나와야 합니다.
기존 화면에서 로그인 후 메모를 조회하고 개발자 도구 Network의 `/api/learning-notes`
응답 헤더를 누르면 `X-Resource-Id: personal_notes`를 확인할 수 있습니다.

## API의 추가 권한 확인

API는 검증된 로그인 사용자 ID를 DB의 `owner_id` 필터에 사용하고, 반환된 행의
저장된 `owner_id`도 다시 대조한 뒤 자료를 보냅니다. 응답에 소유자 ID는 추가하지 않습니다.
다른 사용자의 개별 메모는 존재 여부를 구별할 수 없도록 404 `NOTE_NOT_FOUND`로 거부합니다.
목록에 다른 소유자의 행이 섞여 반환되면 전체 응답을 403 `RESOURCE_ACCESS_DENIED`로 막습니다.
생성 시 소유자는 검증된 사용자로 정하고 수정·삭제도 같은 소유자 필터 안에서 처리합니다.

학생이 확인한 강사 권한 저장 위치는 Auth의 `app_metadata.role`이며 값은 `instructor`입니다.
강사 전용 요청마다 서버 전용 SDK의 `auth.admin.getUserById`로 사용자를 다시 읽고,
반환된 사용자 ID와 저장된 역할을 함께 검사합니다. 본문·헤더·쿼리의 role, user_metadata,
오래된 토큰에 담긴 역할 사본으로 권한을 부여하지 않습니다. 조회 실패는 503
`AUTHORIZATION_UNAVAILABLE`, 사용자 불일치·역할 누락·강사 아님은 403 `INSTRUCTOR_REQUIRED`입니다.

| 서버 API 경로 | 검사와 현재 결과 |
|---|---|
| `/api/learning-notes`, `/api/learning-notes/:id` | 기존 CRUD·소유자 검사, 반환 행 소유자 재대조 |
| `/api/instructor-notices`, `/api/instructor-notices/:id` | 로그인한 GET만, 저장소가 없어 501; 쓰기는 누구에게나 405 |
| `/api/instructor-materials`, `/api/instructor-materials/:id` | GET에서 저장된 강사 권한 필수; 확인 후에도 저장소가 없어 501 |
| POST `/api/admin/instructor-notices` | 저장된 강사 권한 필수; 실제 생성은 미구현으로 501 |
| PUT·PATCH·DELETE `/api/admin/instructor-notices/:id` | 저장된 강사 권한 필수; 실제 수정·삭제는 미구현으로 501 |

관리·강사 자료 경로는 판정기의 allowedRoutes에 추가하지 않습니다. 다른 구역 요청은
개인 메모 DB로 넘기지 않습니다. 거부 로그에는 `api_denied:INSTRUCTOR_REQUIRED`처럼
고정 사유 코드만 남기고 사용자·토큰·요청 본문·자료 내용을 넣지 않습니다.

직접 호출 모의 시험: `node --test test/api-resource-access.test.mjs`.
실제 계정·토큰·서명 키·DB를 사용하지 않는 API 권한 시험이며, 로그인 검증과 DB 응답은
시험용 대역입니다. 본인 메모 200, 타인 메모 404, 일반 사용자의 강사 경로 403,
위조 역할 무시, 저장된 역할 회수 즉시 반영, 구역 간 메모 DB 접근 없음이 통과했습니다.
실제 배포에서의 권한·메뉴 우회 시험은 미실행입니다. 배포 후 기존 화면에서 로그인하고
브라우저 개발자 도구 Console에서 아래 명령을 실행하면 토큰을 꺼내지 않고 확인할 수 있습니다.

`fetch('/api/instructor-materials', { credentials: 'same-origin' }).then(r => console.log(r.status))`

일반 사용자는 403, 저장된 강사는 현재 저장소 미구현으로 501, 무로그인은 401이어야 합니다.
