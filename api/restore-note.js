import { createClient } from '@supabase/supabase-js';
import config from '../aleph.config.json' with { type: 'json' };
import { createLoginVerifier } from '../src/verify-login.mjs';
import { ACCESS_COOKIE, readCookie, sameOrigin } from '../src/session-cookies.mjs';
import { NOTE_ID, verifiedBackupNote, restoreOneNote } from '../src/restore-note.mjs';
import { readDeviceApproval } from '../src/device-approval.mjs';

let verifier;
const error = (response, status, code) => {
  console.warn(`restore_note:${code}`);
  return response.status(status).json({ error: code });
};
export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Resource-Id', 'notes_restore');
  response.setHeader('Vary', 'Authorization, Cookie');
  const url = new URL(request.url ?? '/api/restore-note', 'https://local.invalid');
  if (url.pathname !== '/api/restore-note' || url.search) return error(response, 404, 'NOT_FOUND');
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return error(response, 405, 'METHOD_NOT_ALLOWED');
  }
  const cookie = readCookie(request, ACCESS_COOKIE);
  const usesCookie = request.headers?.authorization === undefined && Boolean(cookie);
  if (usesCookie && !sameOrigin(request)) return error(response, 403, 'ORIGIN_REQUIRED');
  const authorization = request.headers?.authorization ?? (cookie ? `Bearer ${cookie}` : undefined);
  if (!authorization) return error(response, 401, 'LOGIN_REQUIRED');
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const origin = new URL(config.identityProvider.issuer).origin;
  const testOwner = process.env.NOTE_RESTORE_TEST_SUBJECT_ID;
  if (!secretKey || process.env.SUPABASE_URL !== origin || !NOTE_ID.test(testOwner ?? '')) {
    return error(response, 503, 'RESTORE_CONFIGURATION_MISSING');
  }
  let login;
  try {
    verifier ??= createLoginVerifier({ config, supabaseSecretKey: secretKey });
    login = await verifier(authorization);
  } catch { return error(response, 503, 'RESTORE_CONFIGURATION_INVALID'); }
  if (!login) return error(response, 401, 'LOGIN_REQUIRED');
  try {
    const approval = await readDeviceApproval(login);
    if (approval.status === 'unavailable') return error(response, 503, 'DEVICE_APPROVAL_UNAVAILABLE');
    if (!approval.deviceRegistered) return error(response, 403, 'DEVICE_NOT_REGISTERED');
  } catch { return error(response, 503, 'DEVICE_APPROVAL_UNAVAILABLE'); }
  if (login.userId !== testOwner) return error(response, 403, 'RESTORE_TEST_ACCOUNT_REQUIRED');
  let input;
  try { input = typeof request.body === 'string' ? JSON.parse(request.body) : request.body; }
  catch { return error(response, 400, 'INVALID_RESTORE_REQUEST'); }
  if (!input || Array.isArray(input) || Object.keys(input).join(',') !== 'id'
      || typeof input.id !== 'string' || !NOTE_ID.test(input.id)) return error(response, 400, 'INVALID_RESTORE_REQUEST');
  try {
    const note = verifiedBackupNote({ backupText: process.env.NOTE_RESTORE_BACKUP_JSON,
      trustedBackupSha256: process.env.NOTE_RESTORE_BACKUP_SHA256, id: input.id, ownerId: login.userId });
    const supabase = createClient(origin, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    const result = await restoreOneNote(supabase, note);
    // 기존 감사 이력은 건드리지 않고 내용 없는 완료 사건만 추가 기록합니다.
    console.info('restore_note:completed');
    return response.status(200).json(result);
  } catch (failure) {
    const code = /^RESTORE_[A-Z_]+$/u.test(failure.message ?? '') ? failure.message : 'RESTORE_DATABASE_UNAVAILABLE';
    const status = code === 'RESTORE_TARGET_NOT_FOUND' ? 404
      : ['RESTORE_OWNER_MISMATCH', 'RESTORE_CONFLICT', 'RESTORE_RESULT_MISMATCH'].includes(code) ? 409
      : ['RESTORE_BACKUP_INVALID', 'RESTORE_CONTENT_HASH_MISMATCH'].includes(code) ? 422 : 503;
    return error(response, status, code);
  }
}
