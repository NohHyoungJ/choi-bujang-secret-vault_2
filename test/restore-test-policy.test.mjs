import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { planTestRestore, prepareTestRestore, applyTestRestoreFile } from '../src/restore-test-policy.mjs';

// 시험용 대역 사본·검증 기록이며 실제 정책·승인 기록이 아닙니다.
const hash = text => createHash('sha256').update(text).digest('hex');
function fixture() {
  const backup = { schema: 'aleph.test-policy.v1', environment: 'test', version: 'synthetic-safe',
    allowedRoutes: ['GET /api/notes/:id'], ruleIds: ['device_registered'] };
  const state = { schema: 'aleph.test-policy-store.v1', environment: 'test', services: {
    vault: { ...backup, version: 'synthetic-current', allowedRoutes: ['GET /api/notes'], ruleIds: [] },
    other: { ...backup, version: 'synthetic-other', allowedRoutes: ['GET /api/health'], ruleIds: ['other_rule'] },
  }, auditHistory: [{ action: 'synthetic_old_audit' }] };
  const backupText = JSON.stringify(backup);
  const verificationText = JSON.stringify({ schema: 'aleph.test-policy-verification.v1', environment: 'test',
    backupVersion: backup.version, backupSha256: hash(backupText), result: 'passed',
    verifiedAt: '2026-10-01T00:00:00.000Z', incidentAt: '2026-10-02T00:00:00.000Z' });
  return { serviceId: 'vault', storeText: JSON.stringify(state), backupText, verificationText,
    trustedVerificationSha256: hash(verificationText) };
}

test('확인한 버전·변경 범위만 선택 서비스에 적용하고 다른 서비스·기존 감사 이력을 보존한다', () => {
  const input = fixture();
  const original = structuredClone(input);
  const plan = planTestRestore(input);
  assert.equal(plan.restoreVersion, 'synthetic-safe');
  assert.deepEqual(plan.changes[0], { section: 'allowedRoutes', add: ['GET /api/notes/:id'], remove: ['GET /api/notes'] });
  const result = prepareTestRestore({ ...input, confirmedPlanSha256: plan.planSha256 });
  const before = JSON.parse(input.storeText);
  const after = JSON.parse(result.storeText);
  assert.deepEqual(after.services.vault, JSON.parse(input.backupText));
  assert.deepEqual(after.services.other, before.services.other);
  assert.deepEqual(after.auditHistory.slice(0, -1), before.auditHistory);
  assert.equal(after.auditHistory.at(-1).action, 'restore_test_policy');
  assert.deepEqual(input, original);
});

test('확인 코드 누락·다른 서비스·실행 전 상태 변경은 중단한다', () => {
  const input = fixture();
  const plan = planTestRestore(input);
  assert.throws(() => prepareTestRestore(input), { message: 'restore_apply_confirmation_mismatch' });
  assert.throws(() => prepareTestRestore({ ...input, serviceId: 'other', confirmedPlanSha256: plan.planSha256 }),
    { message: 'restore_apply_confirmation_mismatch' });
  const changed = JSON.parse(input.storeText);
  changed.auditHistory.push({ action: 'synthetic_new_audit' });
  assert.throws(() => prepareTestRestore({ ...input, storeText: JSON.stringify(changed), confirmedPlanSha256: plan.planSha256 }),
    { message: 'restore_apply_confirmation_mismatch' });
});

test('사본 검증 실패와 운영 환경은 적용 전에 중단한다', () => {
  const input = fixture();
  assert.throws(() => prepareTestRestore({ ...input, backupText: input.backupText + ' ' }),
    { message: 'restore_preview_backup_not_verified' });
  const state = JSON.parse(input.storeText);
  state.environment = 'production';
  assert.throws(() => planTestRestore({ ...input, storeText: JSON.stringify(state) }),
    { message: 'restore_apply_invalid_test_store' });
});

test('시험 파일만 교체하고 실패·잠금·범위 밖 파일은 그대로 남긴다', () => {
  const parent = mkdtempSync(join(tmpdir(), 'vault-restore-synthetic-'));
  const root = join(parent, 'test');
  mkdirSync(root);
  const target = join(root, 'store.json');
  const outside = join(parent, 'outside.json');
  const input = fixture();
  writeFileSync(target, input.storeText);
  writeFileSync(outside, input.storeText);
  try {
    const plan = planTestRestore(input);
    const options = { ...input, testRoot: root, storePath: target, confirmedPlanSha256: plan.planSha256 };
    assert.throws(() => applyTestRestoreFile({ ...options, confirmedPlanSha256: undefined }),
      { message: 'restore_apply_confirmation_mismatch' });
    assert.equal(readFileSync(target, 'utf8'), input.storeText);
    assert.throws(() => applyTestRestoreFile({ ...options, storePath: outside }),
      { message: 'restore_apply_invalid_test_path' });
    assert.equal(readFileSync(outside, 'utf8'), input.storeText);
    writeFileSync(`${target}.restore.lock`, 'synthetic-lock');
    assert.throws(() => applyTestRestoreFile(options), { message: 'restore_apply_locked' });
    unlinkSync(`${target}.restore.lock`);
    assert.equal(applyTestRestoreFile(options).mode, 'restored_test_policy');
    const restored = JSON.parse(readFileSync(target, 'utf8'));
    assert.deepEqual(restored.services.other, JSON.parse(input.storeText).services.other);
    assert.equal(restored.auditHistory.length, 2);
    assert.deepEqual(restored.services.vault, JSON.parse(input.backupText));
  } finally {
    unlinkSync(target);
    unlinkSync(outside);
    rmdirSync(root);
    rmdirSync(parent);
  }
});
