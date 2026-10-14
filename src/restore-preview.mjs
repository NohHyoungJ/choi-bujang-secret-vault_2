import { createHash } from 'node:crypto';

const digest = value => createHash('sha256').update(value).digest('hex');
const fail = code => { throw new Error(code); };
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const secret = /-----BEGIN|\bBearer\s|\bsb_secret_|\bsk-[A-Za-z0-9_-]{20,}|\beyJ[A-Za-z0-9_-]+\.|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu;
const version = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(value);
const utcTime = value => {
  const at = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(at) && new Date(at).toISOString() === value ? at : NaN;
};
function parse(text) {
  if (typeof text !== 'string' || !text || text.length > 1024 * 1024 || secret.test(text)) {
    fail('restore_preview_invalid_or_sensitive_input');
  }
  try { return JSON.parse(text); } catch { fail('restore_preview_invalid_json'); }
}
export function validateTestPolicy(text) {
  const value = parse(text);
  const unique = items => Array.isArray(items) && new Set(items).size === items.length;
  if (!exactKeys(value, ['schema', 'environment', 'version', 'allowedRoutes', 'ruleIds'])
      || value.schema !== 'aleph.test-policy.v1' || value.environment !== 'test'
      || !version(value.version) || !unique(value.allowedRoutes) || !unique(value.ruleIds)
      || value.allowedRoutes.length > 100 || value.ruleIds.length > 80
      || value.allowedRoutes.some(route => typeof route !== 'string'
        || !/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) \/[A-Za-z0-9/_:.-]*$/u.test(route)
        || route.split('/').some(segment => segment === '.' || segment === '..'))
      || value.ruleIds.some(id => typeof id !== 'string' || !/^[a-z][a-z0-9_.-]{0,79}$/u.test(id))) {
    fail('restore_preview_invalid_test_policy');
  }
  return value;
}

// 신뢰 기준은 외부의 검증 기록에서 받습니다. 이 함수가 안전 여부를 자체 승인하지 않습니다.
export function previewRestore({ backupText, currentText, verificationText, trustedVerificationSha256 } = {}) {
  if (!backupText) fail('restore_preview_missing_backup');
  if (!currentText) fail('restore_preview_missing_current_policy');
  if (!verificationText || !/^[a-f0-9]{64}$/u.test(trustedVerificationSha256 ?? '')) {
    fail('restore_preview_missing_trusted_verification');
  }
  if (digest(verificationText) !== trustedVerificationSha256) fail('restore_preview_verification_mismatch');
  const verification = parse(verificationText);
  if (!exactKeys(verification, ['schema', 'environment', 'backupVersion', 'backupSha256',
    'verifiedAt', 'incidentAt', 'result'])
      || verification.schema !== 'aleph.test-policy-verification.v1'
      || verification.environment !== 'test' || verification.result !== 'passed'
      || !Number.isFinite(utcTime(verification.verifiedAt)) || !Number.isFinite(utcTime(verification.incidentAt))
      || utcTime(verification.verifiedAt) >= utcTime(verification.incidentAt)
      || digest(backupText) !== verification.backupSha256) fail('restore_preview_backup_not_verified');
  const backup = validateTestPolicy(backupText);
  const current = validateTestPolicy(currentText);
  if (backup.version !== verification.backupVersion) fail('restore_preview_backup_version_mismatch');
  const changes = [];
  for (const section of ['allowedRoutes', 'ruleIds']) {
    const add = backup[section].filter(item => !current[section].includes(item)).sort();
    const remove = current[section].filter(item => !backup[section].includes(item)).sort();
    if (add.length || remove.length) changes.push({ section, add, remove });
  }
  return { mode: 'preview', environment: 'test', currentVersion: current.version,
    restoreVersion: backup.version, verifiedAt: verification.verifiedAt, changes };
}
