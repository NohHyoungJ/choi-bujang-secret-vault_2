# 10단계 시험 정책 복원 미리보기

현재 검증된 안전 정책 사본이 없어 미리보기 실행은 중단됩니다. 현재 정책이나 Git 저장점을
검증된 안전 사본으로 자체 승인하지 않습니다. 파일 생성·정책 적용·회수 API 호출은 없습니다.

이 문장의 파일 생성·정책 적용 없음은 미리보기 명령에 해당합니다. 아래 확인 절차를
통과한 시험 서비스 복원 명령은 명시한 시험 저장 파일만 교체합니다.

`npm run restore:preview`는 기본적으로 `restore_preview_missing_backup`으로 중단합니다.
사본이 준비된 뒤에는 다음 네 입력이 모두 필요합니다.

- `--backup`: 침해 전 검증된 시험 정책 JSON 사본
- `--current`: 현재 시험 정책 JSON
- `--verification`: 별도로 신뢰할 수 있는 검증 기록 JSON
- `--trusted-verification-sha256`: 외부에서 신뢰를 확인한 검증 기록 원문의 SHA-256

검증 기록 옆에서 해시를 새로 계산해 붙이는 것만으로 안전 검증이 성립하지 않습니다.
이 기준값은 침해 전 승인 기록이나 운영 측의 신뢰할 수 있는 전달 경로에서 받아야 합니다.
이 기능은 승인 사실을 새로 판정하지 않고 그 기록의 무결성·사본 연결·시점을 대조합니다.
기준값이나 기록이 없으면 중단합니다. 비밀번호·토큰·개인키를 입력하지 않습니다.

## 로컬 미리보기 입력 계약

시험 정책의 필드는 다음 다섯 항목만 허용합니다.

```json
{
  "schema": "aleph.test-policy.v1",
  "environment": "test",
  "version": "synthetic-policy-v1",
  "allowedRoutes": ["GET /api/notes/:id"],
  "ruleIds": ["device_registered"]
}
```

검증 기록 필드는 `schema: aleph.test-policy-verification.v1`, `environment: test`,
`backupVersion`, `backupSha256`, `verifiedAt`, `incidentAt`, `result: passed`입니다.
시각은 UTC ISO 형식이며 verifiedAt이 incidentAt보다 앞서야 합니다. 원문 사본의 해시와
버전이 검증 기록과 같아야 합니다. 운영 환경이나 추가 자료 필드는 거부합니다.

출력에는 현재 버전·복원할 버전·검증 시각과 `allowedRoutes`, `ruleIds`의 차이만 있습니다.
`add`는 복원하면 추가될 항목, `remove`는 복원하면 제거될 항목입니다. 같은 정책이면
변경 범위는 빈 배열입니다. 오류 때는 사본 내용이나 경로를 출력하지 않고 고정 사유만
표시합니다. 이 형식은 로컬 시험용으로, 실행 코드·메모·DB·전체 운영 정책의 백업 형식이 아닙니다.

화면 조작은 없습니다. 터미널에서 `npm run restore:preview`를 실행하면 현재는 사본 없음으로
중단해야 합니다. 합성 입력 시험은 `node --test test/restore-preview.test.mjs`입니다.
검증된 합성 입력은 버전과 차이를 반환하고, 누락·변조·검증 실패·침해 후 검증·운영 환경은
중단해야 합니다. 합성 시험 통과를 실제 안전 사본 검증이나 실제 복원 완료로 보고하지 않습니다.

## 선택한 시험 서비스만 복원하기

시험 저장 파일은 작업 폴더의 `policies/test/` 안에 있어야 하고 다음 형태를 사용합니다.
안전 사본과 검증 기록은 앞 절차의 계약 그대로 사용합니다.

```json
{
  "schema": "aleph.test-policy-store.v1",
  "environment": "test",
  "services": {
    "vault": {
      "schema": "aleph.test-policy.v1",
      "environment": "test",
      "version": "synthetic-current",
      "allowedRoutes": ["GET /api/notes/:id"],
      "ruleIds": ["device_registered"]
    }
  },
  "auditHistory": []
}
```

1. `npm run restore:test-policy -- --backup <사본파일> --store <시험저장파일> --service vault --verification <검증기록> --trusted-verification-sha256 <외부확인기준값>`으로 미리보기를 실행합니다.
2. 출력의 serviceId, currentVersion, restoreVersion, changes를 확인합니다. 추가·제거 항목이 기대한 범위일 때만 출력의 planSha256 확인 코드를 사용합니다.
3. 같은 명령 뒤에 `--apply --confirm-plan-sha256 <확인한코드>`를 붙여 시험 정책에 적용합니다. `--apply`만으로는 실행되지 않습니다.

실행 때 사본과 검증 기록을 다시 검증합니다. 확인 코드는 선택 서비스·사본·현재 저장 파일
전체·검증 기록에 묶여 있으므로, 다른 서비스나 감사 이력을 포함해 상태가 바뀌면 중단하고
미리보기부터 다시 해야 합니다. 경로의 실제 위치를 확인하며 범위 밖 파일·심볼릭 링크·운영
환경은 거부합니다. 관리 대상 저장 파일의 모든 작성자는 같은 `.restore.lock` 잠금을 따라야 합니다.
협조하지 않는 외부 작성자와의 동시 변경은 보장하지 않으므로 시험 저장 파일을 단독으로 관리합니다.

선택한 서비스 정책만 사본으로 교체하며 다른 서비스 정책은 유지합니다. 기존 auditHistory는
삭제·덮어쓰기하지 않고 복원 서비스·버전·확인 코드·시각을 담은 항목 한 개를 추가합니다.
정책과 감사 이력을 같은 임시 파일에 준비한 뒤 저장 파일을 한 번에 교체합니다.
이 절차는 로컬 시험 정책 메타데이터 복원이며, 운영 설정·판정기 코드·DB·학습 자료를
변경하거나 외부 복원 API를 호출하지 않습니다.

현재 안전 사본·검증 기록·시험 저장 파일이 없어 실제 적용은 중단됩니다.
화면 조작 없이 터미널에서 위 변경 항목을 확인합니다. 확인 시험:
`node --test test/restore-test-policy.test.mjs`.
합성 입력에서 선택 서비스 복원·다른 서비스 및 감사 보존을 확인하고, 확인 누락·상태 변경·
검증 실패·운영 환경·범위 밖·잠금 충돌은 적용 전에 거부돼야 합니다.

## 복원 후 A/B 접근 확인

기존 API는 검증된 로그인 사용자와 저장된 owner_id를 비교합니다. A/B를 정책에
고정 사용자 ID로 추가하거나 B 전체를 차단하지 않습니다. B의 A 자료 GET·PUT·DELETE는
404 NOTE_NOT_FOUND이고, 각 거부 뒤 A의 같은 자료 GET은 200이어야 합니다.
B의 실패한 수정·삭제가 A의 자료에 영향을 주면 안 됩니다.

모의 확인: `node --test test/api-resource-access.test.mjs`.
이 시험은 인증·DB 대역으로 위 거부와 정상 유지 순서를 확인합니다. 실제 계정·DB 시험이
아니며, 현재 안전 사본이 없어 실제 복원 후 확인은 미실행입니다. 로컬 시험 정책 파일 복원만으로
실제 API·운영 정책이 바뀌었다고 보고하지 않습니다.

실제 배포 확인은 A로 로그인해 자기 자료를 읽고, B로 로그인한 브라우저에서 같은
자료 UUID를 직접 GET한 뒤 다시 A로 정상 조회하는 순서입니다. 개발자 도구 Console에서
`fetch('/api/learning-notes/' + encodeURIComponent('확인할 자료 UUID'), {credentials: 'same-origin'}).then(r => console.log(r.status))`
로 상태 코드만 확인합니다. A는 200, B는 404여야 합니다. 토큰·자료 본문을 출력하지 않습니다.
