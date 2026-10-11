import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide } from './decide.mjs';

const ROOT = new URL('../../', import.meta.url);
const TTL_MS = 5 * 60 * 1000;
const ID = /^[a-zA-Z0-9_.-]{1,80}$/u;
const PATTERN_NAMES = new Set([
  '요청 인자의 SQL 주입 형태',
  '요청 인자의 스크립트 태그 삽입 형태',
  '상위 디렉터리 이동을 반복하는 경로 탐색 형태',
]);

// Adapter inputs must come from the trusted engine, never alert.data.srcuser or a browser.
// No account/IP-wide bans: a confirmed attacking device and its verified scope are required.
export async function respond(alerts, {
  root = ROOT, now = Date.now(), resolveAttacker, installDenyRule,
  reasonCode, allowedReasonCodes = [],
} = {}) {
  if (!Array.isArray(alerts) || !Number.isFinite(now)) throw new TypeError('invalid_response_input');
  const directory = new URL('xdr/', root instanceof URL ? root : new URL(`file:///${resolve(root).replaceAll('\\', '/')}/`));
  await mkdir(new URL('web-injection/', directory), { recursive: true });
  const candidates = [];
  const logs = [];
  for (const alert of alerts) {
    const result = decide(alert);
    if (result.action === 'record') continue;
    const alertId = typeof alert?.id === 'string' && /^wi-\d{2,6}$/u.test(alert.id) ? alert.id : null;
    const pattern = PATTERN_NAMES.has(result.reason) ? result.reason : '근거 패턴 확인 필요';
    let status = 'notification_only';
    if (result.action === 'block' && result.confidence >= 0.85 && alertId) {
      const observedAt = typeof alert.timestamp === 'string' ? Date.parse(alert.timestamp) : NaN;
      const expiresAt = Number.isFinite(observedAt) ? observedAt + TTL_MS : NaN;
      const candidate = { alertId, action: 'deny', confidence: result.confidence,
        pattern, expiresAt: Number.isFinite(expiresAt) ? new Date(expiresAt).toISOString() : null,
        status: 'pending_verified_attacker' };
      if (!Number.isFinite(expiresAt) || observedAt > now + 5000 || expiresAt <= now) {
        candidate.status = 'expired_or_invalid_time';
      } else if (typeof resolveAttacker === 'function' && typeof installDenyRule === 'function'
          && typeof reasonCode === 'string' && /^[a-z][a-z0-9_]{0,63}$/u.test(reasonCode)
          && allowedReasonCodes.includes(reasonCode)) {
        try {
          const target = await resolveAttacker(alertId);
          if (target?.verified === true && target.confirmedAttacker === true
              && ['classId', 'projectId', 'subjectId'].every(key => typeof target[key] === 'string' && ID.test(target[key]))
              && typeof target.deviceId === 'string' && /^[a-f0-9]{16}$/u.test(target.deviceId)) {
            const rule = {
              id: `xdr.web_injection.${alertId.replaceAll('-', '_')}`, action: 'deny', reasonCode,
              match: { classId: target.classId, projectId: target.projectId,
                subjectId: target.subjectId, deviceId: target.deviceId },
              expiresAt: candidate.expiresAt, evidenceAlertIds: [alertId],
            };
            // The adapter must add this rule, preserve existing rules, and enforce expiry.
            // A plain candidate file is never treated as an installed engine rule.
            const receipt = await installDenyRule(rule);
            candidate.status = receipt?.installed === true && receipt.ruleId === rule.id
              ? 'installed_by_adapter' : 'installation_unconfirmed';
          }
        } catch {
          candidate.status = 'adapter_failed';
        }
      }
      status = candidate.status;
      candidates.push(candidate);
    }
    // Never log raw descriptions, addresses, account names, credentials, or adapter errors.
    logs.push(JSON.stringify({ at: new Date(now).toISOString(), alertId,
      action: result.action, confidence: result.confidence, pattern, status }));
  }
  await writeFile(new URL('web-injection/deny-candidates.json', directory), `${JSON.stringify(candidates, null, 2)}\n`);
  if (logs.length) await appendFile(new URL('alerts.log', directory), `${logs.join('\n')}\n`);
  return { candidates, notifications: logs.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const fixture = JSON.parse(await readFile(new URL('xdr/fixtures/web-injection.json', ROOT), 'utf8'));
    if (fixture.schema !== 'aleph.xdr.fixture.v1' || fixture.moduleKey !== 'web-injection') throw new Error('invalid_fixture');
    const result = await respond(fixture.alerts);
    process.stdout.write(`차단 후보 ${result.candidates.length}건 · 알림 ${result.notifications}건. 운영 어댑터 미연결: 실제 ZTNA 규칙은 변경하지 않았습니다.\n`);
  } catch {
    process.stderr.write('대응 처리에 실패했습니다. 입력 형식과 저장 경로를 확인하세요.\n');
    process.exitCode = 1;
  }
}
