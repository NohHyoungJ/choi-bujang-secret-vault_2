import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { previewRestore } from '../src/restore-preview.mjs';

function read(path, code) {
  if (!path) throw new Error(code);
  try { return readFileSync(path, 'utf8'); } catch { throw new Error(code); }
}
try {
  const { values } = parseArgs({ options: {
    backup: { type: 'string' }, current: { type: 'string' }, verification: { type: 'string' },
    'trusted-verification-sha256': { type: 'string' },
  } });
  const preview = previewRestore({
    backupText: read(values.backup, 'restore_preview_missing_backup'),
    currentText: read(values.current, 'restore_preview_missing_current_policy'),
    verificationText: read(values.verification, 'restore_preview_missing_trusted_verification'),
    trustedVerificationSha256: values['trusted-verification-sha256'],
  });
  process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
} catch (error) {
  const code = /^restore_preview_[a-z_]+$/u.test(error.message ?? '')
    ? error.message : 'restore_preview_invalid_arguments';
  process.stderr.write(`복원 미리보기 중단: ${code}\n`);
  process.exitCode = 1;
}
