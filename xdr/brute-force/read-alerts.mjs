import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE = new URL('../fixtures/brute-force.json', import.meta.url);
const HIDDEN = '[숨김]';
// Mask the entire selected value rather than risking partial credential disclosure.
const SECRET = /-----BEGIN|\bBearer\s+\S+|\b(?:sb_(?:secret|publishable)_|sk-|gh[pousr]_|github_pat_)[\w-]+|\beyJ[\w-]*\.[\w-]+\.[\w-]+|(?:password|passwd|pwd|token|secret|api[_ -]?key|비밀번호|비밀키|토큰)\s*[=:：]|[A-Za-z0-9_+/=-]{32,}/iu;

function safeText(value) {
  if (typeof value !== 'string') return null;
  if (value.length > 1000 || SECRET.test(value)) return HIDDEN;
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ');
}

export function extractAlerts(fixture) {
  if (fixture?.schema !== 'aleph.xdr.fixture.v1'
      || fixture.moduleKey !== 'brute-force' || !Array.isArray(fixture.alerts)) {
    throw new TypeError('가상 경보 묶음 형식이 아닙니다.');
  }
  return fixture.alerts.map(alert => {
    const timestamp = safeText(alert?.timestamp);
    const srcip = safeText(alert?.data?.srcip);
    const level = alert?.rule?.level;
    return {
      timestamp: timestamp === HIDDEN ? HIDDEN : typeof timestamp === 'string'
        && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(timestamp)
        && Number.isFinite(Date.parse(timestamp)) ? timestamp : null,
      srcip: srcip === HIDDEN ? HIDDEN : typeof srcip === 'string' && isIP(srcip) ? srcip : null,
      srcuser: safeText(alert?.data?.srcuser),
      level: Number.isInteger(level) && level >= 0 && level <= 16 ? level : null,
      description: safeText(alert?.rule?.description),
    };
  });
}

export async function readAlerts() {
  let fixture;
  try { fixture = JSON.parse(await readFile(FIXTURE, 'utf8')); }
  catch { throw new Error('가상 경보 파일을 읽을 수 없습니다.'); }
  return extractAlerts(fixture);
}

// Inspection only: importing this module does not print or run a decision.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(`${JSON.stringify(await readAlerts(), null, 2)}\n`); }
  catch { process.stderr.write('경보 읽기에 실패했습니다. 파일과 형식을 확인하세요.\n'); process.exitCode = 1; }
}
