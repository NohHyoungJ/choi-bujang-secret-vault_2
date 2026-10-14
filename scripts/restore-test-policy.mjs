import { readFileSync, realpathSync, lstatSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { resolve, relative, isAbsolute } from 'node:path';
import { planTestRestore, applyTestRestoreFile } from '../src/restore-test-policy.mjs';

const read = (path, code) => {
  if (!path) throw new Error(code);
  try { return readFileSync(path, 'utf8'); } catch { throw new Error(code); }
};
try {
  const { values } = parseArgs({ options: {
    backup: { type: 'string' }, store: { type: 'string' }, service: { type: 'string' },
    verification: { type: 'string' }, 'trusted-verification-sha256': { type: 'string' },
    apply: { type: 'boolean', default: false }, 'confirm-plan-sha256': { type: 'string' },
  } });
  const backupText = read(values.backup, 'restore_preview_missing_backup');
  const storeText = read(values.store, 'restore_apply_missing_test_store');
  let testRoot;
  let storePath;
  try {
    const workspace = realpathSync(process.cwd());
    testRoot = realpathSync(resolve(workspace, 'policies/test'));
    const rootWithin = relative(workspace, testRoot).replace(/\\/gu, '/');
    if (rootWithin.toLowerCase() !== 'policies/test') throw new Error();
    storePath = realpathSync(values.store);
    const within = relative(testRoot, storePath);
    if (!within || within.startsWith('..') || isAbsolute(within)
        || lstatSync(values.store).isSymbolicLink()) throw new Error();
  } catch { throw new Error('restore_apply_invalid_test_path'); }
  const input = { backupText, serviceId: values.service,
    verificationText: read(values.verification, 'restore_preview_missing_trusted_verification'),
    trustedVerificationSha256: values['trusted-verification-sha256'] };
  const plan = planTestRestore({ ...input, storeText });
  if (!values.apply) process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  else {
    // 실시간 확인 없이 apply 옵션만 주어서는 실행하지 않습니다.
    if (values['confirm-plan-sha256'] !== plan.planSha256) throw new Error('restore_apply_confirmation_mismatch');
    const result = applyTestRestoreFile({ ...input, testRoot, storePath,
      confirmedPlanSha256: values['confirm-plan-sha256'] });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
} catch (error) {
  const code = /^restore_(?:preview|apply)_[a-z_]+$/u.test(error.message ?? '')
    ? error.message : 'restore_apply_failed';
  process.stderr.write(`시험 정책 복원 중단: ${code}\n`);
  process.exitCode = 1;
}
