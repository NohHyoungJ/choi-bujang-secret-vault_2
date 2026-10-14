# 9단계 탐지 연습 사건 계약

`npm run detect:test`는 학생이 작성한 `src/detect.mjs`의 `detect(events)`에 가상 조회 사건을 전달합니다. 원래 제공된 사건에는 `at`, `method`, `identity.sub`만 있었습니다. 학생의 요청으로 로컬 가상 사건에 아래 `signals`를 추가했습니다. 이는 운영 엔진의 계약 변경이나 실제 네트워크 검증을 의미하지 않습니다.

```js
{
  at: '2026-10-01T00:00:00.000Z',
  method: 'GET',
  identity: { sub: 'learner_fixture' },
  signals: { source: 'judge_fixture', network: 'unusual' }
}
```

같은 `identity.sub`의 GET 중 `signals.source === 'judge_fixture'`이고 `network === 'unusual'`인 사건만 집계합니다. 이 조회가 어느 10분 구간에서든 **120건을 넘을 때만** `{ action: 'flag_suspicious', reasonCode: 'unusual_network_burst', subject: '해당 가명 sub' }`로 의심을 표시합니다. 정확히 120건, 평소 네트워크의 다량 조회, 다른 네트워크의 소량 조회는 `{ action: 'observe' }`입니다. 평소 네트워크 조회와 다른 네트워크의 소량 조회를 합산하지 않습니다. 사용자 간 사건과 10분 밖의 사건도 합산하지 않습니다.

`usual`은 가상 평소 네트워크, `unusual`은 가상 다른 네트워크입니다. 네트워크나 출처가 없거나 출처가 불명확하면 값을 채우지 않고 의심 표시 조건에서 제외합니다. `at`는 UTC ISO 시각이어야 합니다. 잘못된 시각은 내용 없는 `invalid_detection_event`로 거부합니다. 지역은 읽거나 조건에 사용하지 않습니다.

원래 제공된 연습의 다량 조회만으로 `propose_revocation`을 반환하는 기대 결과는 이번 로컬 복합 의심 시험에 사용하지 않습니다. 실제 권한 회수는 수행하지 않습니다.

이 파일의 사건 모양은 **로컬 연습용**입니다. 브라우저가 보낸 사용자 번호를 신원으로 취급하지 않습니다. 운영 반 엔진이 검증한 사건을 전달하고 회수 제안을 집행하는 경로는 별도로 연결·시험해야 합니다. 이 명령의 통과를 실제 접속 차단이나 심판 판정으로 표시하지 않습니다.

## 9단계 입력 처리 구현

`readDetectionEvents(events)`는 `identity.sub`와 `method`만 선택해서
`{subjectId, deviceId: null, requestKind, decision: null}`로 반환합니다.
원본 객체를 복사하지 않으며 메모 본문·토큰·실명·계약 밖의 필드를 읽지 않습니다.
현재 사건 계약에는 기기와 판정이 없으므로, `null`은 정보 없음이며 정상 판정이 아닙니다.
사건 배열을 파일·로그·전역 상태에 저장하거나 출력하지 않습니다.
가명 문자열과 요청 종류의 형식이 잘못되면 입력 내용 없는 고정 오류로 거부합니다.
문자열 형식 검사만으로 가명 여부를 보장할 수는 없으며 실제 신원 검증은 제공 엔진의 책임입니다.

입력 처리 확인: `node --test test/detect-input.test.mjs`.
정상 30건과 의심 121건이 비밀값 없이 추출돼야 하며, 잘못된 입력은
`invalid_detection_event`로 거부돼야 합니다. 화면 조작 없이 터미널 결과를 확인합니다.
`readDetectionEvents`의 네 항목 추출은 유지하고, `detect` 내부에서 집계에 필요한 시각과 가상 네트워크 두 값만 추가로 읽습니다. 원본 객체를 출력하거나 저장하지 않습니다.

복합 의심 시험: `npm run detect:test`. 정상 사건·단일 이상·경계값·사용자 분리·시간 분리·출처 누락은 observe, 다른 네트워크의 10분 내 121건 이상 조회만 flag_suspicious여야 합니다. 화면 조작 없이 터미널 결과를 확인합니다. 운영 반 엔진의 사건 전달·실제 네트워크 검증·권한 회수는 미연결·미실행입니다.

## 별도 가상 기기 회수 제안

학생 요청으로 로컬 사건 계약에 선택 항목을 추가했습니다.

```js
fixtureDevice: { source: 'judge_fixture', verified: true, id: 'aaaaaaaaaaaaaaaa' }
```

이 값은 확인된 **가상** 기기를 표현하는 연습 표시이며 실제 기기 검증 증거가 아닙니다.
ID는 16자리 소문자 16진수이며 개인키가 아닙니다. 출처·확인 표시·ID가 없거나
형식이 맞지 않으면 회수 대상을 추측하지 않습니다. 일반 `deviceId`나 브라우저 주장은
대상으로 사용하지 않습니다. 기존 안전 추출 함수의 네 항목 출력은 유지합니다.

같은 사용자·같은 확인 기기의 다른 네트워크 GET이 10분 내 120건을 넘으면
탐지 결과에 아래 `revocationProposal` 하나만 붙입니다.

```js
{
  action: 'flag_suspicious',
  reasonCode: 'unusual_network_burst',
  subject: 'learner_fixture',
  revocationProposal: {
    action: 'propose_revocation',
    deviceId: 'aaaaaaaaaaaaaaaa',
    reasonCode: 'unusual_network_burst'
  }
}
```

다른 기기·사용자·10분 밖 사건을 대상 기기의 조회 건수에 합치지 않습니다.
복합 의심만 확인되고 한 기기의 근거가 부족하면 의심 표시만 반환합니다.
정상 사건에는 회수 제안이 없습니다. 접속 판정기 `decide(request)`의 응답 다섯 항목은
변경하지 않습니다. 회수 API·외부 호출·기기 권한 변경·회수 시간 측정은 수행하지 않습니다.
실제 회수와 시간은 심판이 확인하며 현재 구현의 실제 운영 연결은 미실행입니다.

확인: `node --test test/detect-revocation.test.mjs`.
화면 조작 없이 터미널에서 정상·미확인 기기의 제안 없음과 확인 기기 하나의 제안을
확인합니다. 비밀값·메모 내용·실명을 시험이나 결과에 포함하지 않습니다.
