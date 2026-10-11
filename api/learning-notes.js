import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import config from '../aleph.config.json' with { type: 'json' };
import { createLoginVerifier } from '../src/verify-login.mjs';
import { ACCESS_COOKIE, readCookie, sameOrigin } from '../src/session-cookies.mjs';

function sendError(response, status, code) {
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
  const match = /^\/api\/learning-notes(?:\/([^/]+))?\/?$/.exec(path);
  if (!match) return sendError(response, 404, 'NOT_FOUND');
  const id = match[1];
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const methods = id ? ['GET', 'PUT', 'DELETE'] : ['GET', 'POST'];
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
  if (id && !uuid.test(id)) return sendError(response, 400, 'INVALID_ID');

  let input;
  if (['POST', 'PUT'].includes(request.method)) {
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
        || parsedUrl.pathname !== '/' || parsedUrl.search || parsedUrl.hash) {
      return sendError(response, 503, 'SERVER_CONFIGURATION_INVALID');
    }

    const supabase = createClient(parsedUrl.origin, secretKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
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
    if (!id) query = table().select('note_id,title,content').eq('owner_id', login.userId).order('created_at').order('note_id');
    else if (request.method === 'GET') query = table().select('note_id,title,content')
      .eq('note_id', id).eq('owner_id', login.userId).maybeSingle();
    else if (request.method === 'PUT') query = table().update({ title: input.title,
      content: input.body, owner_id: login.userId })
      .eq('note_id', id).eq('owner_id', login.userId).select('note_id,title,content').maybeSingle();
    else query = table().delete().eq('note_id', id).eq('owner_id', login.userId).select('note_id').maybeSingle();
    const { data, error } = await query;
    if (error) return sendError(response, 502, 'LEARNING_NOTES_UNAVAILABLE');
    if (id && !data) return sendError(response, 404, 'NOTE_NOT_FOUND');
    if (request.method === 'DELETE') return response.status(200).json({ id });
    const note = row => ({ id: row.note_id, title: row.title, body: row.content });
    return response.status(200).json(id ? note(data) : data.map(note));
  } catch {
    // Never log or return the Supabase URL, key, or upstream error details.
    return sendError(response, 502, 'LEARNING_NOTES_UNAVAILABLE');
  }
}
