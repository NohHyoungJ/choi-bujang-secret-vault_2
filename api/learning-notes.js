import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import config from '../aleph.config.json' with { type: 'json' };
import { createLoginVerifier } from '../src/verify-login.mjs';
import { ACCESS_COOKIE, readCookie, sameOrigin } from '../src/session-cookies.mjs';
import { RESOURCE_IDS, resourceForPath } from '../src/resource-ids.mjs';
import { readDeviceApproval } from '../src/device-approval.mjs';

function sendError(response, status, code) {
  // 짧은 고정 사유만 기록합니다. 사용자·토큰·요청 본문·자료 내용은 기록하지 않습니다.
  if (status >= 400 && status < 500) console.warn(`api_denied:${code}`);
  return response.status(status).json({ error: code });
}

// Create the verifier once per server instance. It needs the server-only secret key,
// so it is built lazily: a configuration problem becomes a 503 instead of a crash.
let verifier;
function getVerifier() {
  verifier ??= createLoginVerifier({ config, supabaseSecretKey: process.env.SUPABASE_SECRET_KEY });
  return verifier;
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Vary', 'Authorization, Cookie');

  const path = new URL(request.url ?? '/api/learning-notes', 'https://local.invalid').pathname;
  const resource = resourceForPath(path);
  if (!resource) return sendError(response, 404, 'NOT_FOUND');
  const { resourceId, itemId: id } = resource;
  response.setHeader('X-Resource-Id', resourceId);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const requiresInstructor = resourceId === RESOURCE_IDS.instructorMaterials
    || resourceId === RESOURCE_IDS.noticeManagement;
  const methods = resourceId === RESOURCE_IDS.noticeManagement
    ? (id ? ['PUT', 'PATCH', 'DELETE'] : ['POST'])
    : resourceId !== RESOURCE_IDS.personalNotes
      ? ['GET'] : id ? ['GET', 'PUT', 'DELETE'] : ['GET', 'POST'];
  if (!methods.includes(request.method)) {
    response.setHeader('Allow', methods.join(', '));
    return sendError(response, 405, 'METHOD_NOT_ALLOWED');
  }

  // Only the Authorization header is read. A userId/role sent by the browser
  // (query, body, or other headers) is ignored; identity comes from the verified token.
  const denyLogin = () => {
    response.setHeader('WWW-Authenticate', 'Bearer');
    return sendError(response, 401, 'LOGIN_REQUIRED');
  };
  const cookieToken = readCookie(request, ACCESS_COOKIE);
  const usesCookie = request.headers.authorization === undefined && Boolean(cookieToken);
  if (usesCookie && request.method !== 'GET' && !sameOrigin(request)) {
    return sendError(response, 403, 'ORIGIN_REQUIRED');
  }
  const authorization = request.headers.authorization ?? (cookieToken ? `Bearer ${cookieToken}` : undefined);
  if (typeof authorization !== 'string' || !authorization) return denyLogin();

  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) {
    return sendError(response, 503, 'SERVER_CONFIGURATION_MISSING');
  }

  // Verify the token before touching the database. Failure returns no notes.
  let login;
  try {
    login = await getVerifier()(authorization);
  } catch {
    return sendError(response, 503, 'SERVER_CONFIGURATION_INVALID');
  }
  if (!login) return denyLogin();
  try {
    const approval = await readDeviceApproval(login);
    if (approval.status === 'unavailable') return sendError(response, 503, 'DEVICE_APPROVAL_UNAVAILABLE');
    if (!approval.deviceRegistered) return sendError(response, 403, 'DEVICE_NOT_REGISTERED');
  } catch { return sendError(response, 503, 'DEVICE_APPROVAL_UNAVAILABLE'); }
  if (id && !uuid.test(id)) return sendError(response, 400, 'INVALID_ID');

  // 반 공지 저장소는 아직 없습니다. 일반 공지 경로는 쓰기를 열지 않습니다.
  // 공지 요청이 개인 메모 테이블에 접근하는 것을 막습니다.
  if (resourceId === RESOURCE_IDS.instructorNotices) {
    return sendError(response, 501, 'INSTRUCTOR_NOTICES_NOT_CONFIGURED');
  }

  let input;
  if (!requiresInstructor && ['POST', 'PUT'].includes(request.method)) {
    try { input = typeof request.body === 'string' ? JSON.parse(request.body) : request.body; }
    catch { return sendError(response, 400, 'INVALID_NOTE'); }
    if (request.method === 'PUT' && input && Object.hasOwn(input, 'owner_id')) {
      return sendError(response, 400, 'OWNER_CHANGE_NOT_ALLOWED');
    }
    if (!input || typeof input.title !== 'string' || !input.title.trim()
        || typeof input.body !== 'string' || !input.body.trim()
        || input.title.length > 200 || input.body.length > 20000) {
      return sendError(response, 400, 'INVALID_NOTE');
    }
    if (request.method === 'POST' && input.id !== undefined && !uuid.test(input.id)) {
      return sendError(response, 400, 'INVALID_ID');
    }
  }

  try {
    const parsedUrl = new URL(supabaseUrl);
    if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password
        || parsedUrl.pathname !== '/' || parsedUrl.search || parsedUrl.hash
        || parsedUrl.origin !== new URL(config.identityProvider.issuer).origin) {
      return sendError(response, 503, 'SERVER_CONFIGURATION_INVALID');
    }

    const supabase = createClient(parsedUrl.origin, secretKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
    if (requiresInstructor) {
      // 매 요청마다 서버에서 저장된 권한을 다시 읽습니다. JWT의 역할 사본도 사용하지 않습니다.
      let stored;
      try { stored = await supabase.auth.admin.getUserById(login.userId); }
      catch { return sendError(response, 503, 'AUTHORIZATION_UNAVAILABLE'); }
      const { data, error } = stored ?? {};
      if (error) return sendError(response, 503, 'AUTHORIZATION_UNAVAILABLE');
      if (data?.user?.id !== login.userId || data.user.app_metadata?.role !== 'instructor') {
        return sendError(response, 403, 'INSTRUCTOR_REQUIRED');
      }
      // 권한 확인만 추가합니다. 자료 저장소·공지 관리 작업은 미구현입니다.
      return sendError(response, 501, 'RESOURCE_NOT_CONFIGURED');
    }
    const ownedColumns = 'note_id,title,content,owner_id';
    const table = () => supabase.from('learning_notes');
    if (request.method === 'POST') {
      const newId = input.id ?? randomUUID();
      const { error } = await table().insert({ note_id: newId, title: input.title,
        content: input.body, owner_id: login.userId });
      if (error) return sendError(response, error.code === '23505' ? 409 : 502, 'NOTE_CREATE_FAILED');
      return response.status(201).json({ id: newId });
    }
    // Filter by verified identity in the same DB operation to avoid a check/write race.
    let query;
    if (!id) query = table().select(ownedColumns).eq('owner_id', login.userId).order('created_at').order('note_id');
    else if (request.method === 'GET') query = table().select(ownedColumns)
      .eq('note_id', id).eq('owner_id', login.userId).maybeSingle();
    else if (request.method === 'PUT') query = table().update({ title: input.title,
      content: input.body, owner_id: login.userId })
      .eq('note_id', id).eq('owner_id', login.userId).select(ownedColumns).maybeSingle();
    else query = table().delete().eq('note_id', id).eq('owner_id', login.userId).select('note_id,owner_id').maybeSingle();
    const { data, error } = await query;
    if (error) return sendError(response, 502, 'LEARNING_NOTES_UNAVAILABLE');
    if (id && !data) return sendError(response, 404, 'NOTE_NOT_FOUND');
    // DB의 소유자 필터에 더해 반환된 행의 저장된 소유자도 대조합니다.
    if (!id && !Array.isArray(data)) return sendError(response, 502, 'LEARNING_NOTES_UNAVAILABLE');
    const rows = id ? [data] : data;
    if (rows.some(row => !row || row.owner_id !== login.userId)) {
      return sendError(response, id ? 404 : 403, id ? 'NOTE_NOT_FOUND' : 'RESOURCE_ACCESS_DENIED');
    }
    if (request.method === 'DELETE') return response.status(200).json({ id });
    const note = row => ({ id: row.note_id, title: row.title, body: row.content });
    return response.status(200).json(id ? note(data) : data.map(note));
  } catch {
    // Never log or return the Supabase URL, key, or upstream error details.
    return sendError(response, 502, 'LEARNING_NOTES_UNAVAILABLE');
  }
}
