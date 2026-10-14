import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { previewRestore } from '../src/restore-preview.mjs';

// 합성 정책과 모의 검증 기록입니다. 실제 안전 사본이나 승인 기록을 생성하지 않습니다.
const hash = value => createHash('sha256').update(value).digest('hex');
function fixture() {
  const backup = { schema: 'aleph.test-policy.v1', environment: 'test', version: 'synthetic-safe-v1',
    allowedRoutes: ['GET /api/notes/:id'], ruleIds: ['device_registered'] };
  const current = { ...backup, version: 'synthetic-current-v2',
    allowedRoutes: ['GET /api/notes/:id', 'GET /api/notes'], ruleIds: [] };
  const backupText = JSON.stringify(backup);
  const verification = { schema: 'aleph.test-policy-verification.v1', environment: 'test',
    backupVersion: backup.version, backupSha256: hash(backupText),
    verifiedAt: '2026-10-01T00:00:00.000Z', incidentAt: '2026-10-02T00:00:00.000Z', result: 'passed' };
  const verificationText = JSON.stringify(verification);
  return { backupText, currentText: JSON.stringify(current), verificationText,
    trustedVerificationSha256: hash(verificationText) };
}

test('복원 버전과 복원 방향의 차이만 반환하고 입력을 바꾸지 않는다', () => {
  const input = fixture();
  const original = structuredClone(input);
  assert.deepEqual(previewRestore(input), {
    mode: 'preview', environment: 'test', currentVersion: 'synthetic-current-v2',
    restoreVersion: 'synthetic-safe-v1', verifiedAt: '2026-10-01T00:00:00.000Z',
    changes: [
      { section: 'allowedRoutes', add: [], remove: ['GET /api/notes'] },
      { section: 'ruleIds', add: ['device_registered'], remove: [] },
    ],
  });
  assert.deepEqual(input, original);
});

test('같은 정책은 변경 범위가 비어 있다', () => {
  const input = fixture();
  input.currentText = input.backupText;
  assert.deepEqual(previewRestore(input).changes, []);
});

test('사본·현재 정책·신뢰 기준이 없으면 중단한다', () => {
  const input = fixture();
  for (const field of ['backupText', 'currentText', 'verificationText', 'trustedVerificationSha256']) {
    assert.throws(() => previewRestore({ ...input, [field]: undefined }), /^Error: restore_preview_/u);
  }
});

test('사본이나 검증 기록의 변조는 중단한다', () => {
  const input = fixture();
  assert.throws(() => previewRestore({ ...input, backupText: input.backupText + ' ' }),
    { message: 'restore_preview_backup_not_verified' });
  assert.throws(() => previewRestore({ ...input, verificationText: input.verificationText + ' ' }),
    { message: 'restore_preview_verification_mismatch' });
});

test('검증 실패·침해 후 검증·버전 불일치는 중단한다', () => {
  for (const patch of [{ result: 'failed' }, { verifiedAt: '2026-10-03T00:00:00.000Z' },
    { verifiedAt: '2026-10-02T00:00:00.000Z' }, { backupVersion: 'synthetic-other' }]) {
    const input = fixture();
    input.verificationText = JSON.stringify({ ...JSON.parse(input.verificationText), ...patch });
    input.trustedVerificationSha256 = hash(input.verificationText);
    assert.throws(() => previewRestore(input), /^Error: restore_preview_/u);
  }
});

test('운영 환경·예상 밖 자료 필드는 허용하지 않는다', () => {
  for (const patch of [{ environment: 'production' }, { body: 'Synthetic extra field' }]) {
    const input = fixture();
    input.currentText = JSON.stringify({ ...JSON.parse(input.currentText), ...patch });
    assert.throws(() => previewRestore(input), { message: 'restore_preview_invalid_test_policy' });
  }
});
