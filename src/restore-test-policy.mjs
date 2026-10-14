import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, openSync, closeSync, unlinkSync, renameSync,
  realpathSync, lstatSync } from 'node:fs';
import { dirname, join, relative, isAbsolute } from 'node:path';
import { previewRestore, validateTestPolicy } from './restore-preview.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');
const fail = code => { throw new Error(code); };
function store(text, serviceId) {
  let value;
  try { value = JSON.parse(text); } catch { fail('restore_apply_invalid_test_store'); }
  if (!value || Object.keys(value).sort().join(',') !== 'auditHistory,environment,schema,services'
      || value.schema !== 'aleph.test-policy-store.v1' || value.environment !== 'test'
      || !value.services || typeof value.services !== 'object' || Array.isArray(value.services)
      || !Array.isArray(value.auditHistory) || !/^[a-z][a-z0-9_-]{0,63}$/u.test(serviceId ?? '')
      || !Object.hasOwn(value.services, serviceId)) fail('restore_apply_invalid_test_store');
  for (const policy of Object.values(value.services)) validateTestPolicy(JSON.stringify(policy));
  return value;
}

export function planTestRestore({ storeText, serviceId, ...verification }) {
  const value = store(storeText, serviceId);
  const preview = previewRestore({ ...verification, currentText: JSON.stringify(value.services[serviceId]) });
  const plan = { ...preview, serviceId, currentStoreSha256: hash(storeText),
    backupSha256: hash(verification.backupText), verificationSha256: hash(verification.verificationText) };
  return { ...plan, planSha256: hash(JSON.stringify(plan)) };
}

// 선택한 시험 서비스만 교체하고 감사 이력은 추가합니다. 외부 정책 API는 호출하지 않습니다.
export function prepareTestRestore({ storeText, serviceId, confirmedPlanSha256, ...verification }) {
  const plan = planTestRestore({ storeText, serviceId, ...verification });
  if (confirmedPlanSha256 !== plan.planSha256) fail('restore_apply_confirmation_mismatch');
  const value = store(storeText, serviceId);
  const restored = { ...value, services: { ...value.services,
    [serviceId]: validateTestPolicy(verification.backupText) },
  auditHistory: [...value.auditHistory, { action: 'restore_test_policy', serviceId,
    fromVersion: plan.currentVersion, toVersion: plan.restoreVersion,
    planSha256: plan.planSha256, at: new Date().toISOString() }] };
  return { storeText: `${JSON.stringify(restored, null, 2)}\n`, result: {
    mode: 'restored_test_policy', environment: 'test', serviceId,
    restoreVersion: plan.restoreVersion, changes: plan.changes, auditEntryAdded: true } };
}

export function applyTestRestoreFile({ testRoot, storePath, ...input }) {
  let root;
  let target;
  try {
    root = realpathSync(testRoot);
    if (!lstatSync(storePath).isFile() || lstatSync(storePath).isSymbolicLink()) {
      fail('restore_apply_invalid_test_path');
    }
    target = realpathSync(storePath);
  } catch { fail('restore_apply_invalid_test_path'); }
  const within = relative(root, target);
  if (!within || within.startsWith('..') || isAbsolute(within)) fail('restore_apply_invalid_test_path');
  const lock = `${target}.restore.lock`;
  const temporary = join(dirname(target), `.restore-${randomUUID()}.tmp`);
  let handle;
  let temporaryCreated = false;
  try {
    try { handle = openSync(lock, 'wx'); } catch { fail('restore_apply_locked'); }
    const current = readFileSync(target, 'utf8');
    const prepared = prepareTestRestore({ ...input, storeText: current });
    writeFileSync(temporary, prepared.storeText, { flag: 'wx' });
    temporaryCreated = true;
    if (readFileSync(target, 'utf8') !== current) fail('restore_apply_policy_changed');
    renameSync(temporary, target);
    temporaryCreated = false;
    return prepared.result;
  } finally {
    if (temporaryCreated) unlinkSync(temporary);
    if (handle !== undefined) { closeSync(handle); unlinkSync(lock); }
  }
}
