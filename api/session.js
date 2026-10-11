import { createClient } from '@supabase/supabase-js';
import config from '../aleph.config.json' with { type: 'json' };
import { createLoginVerifier } from '../src/verify-login.mjs';
import { ACCESS_COOKIE, REFRESH_COOKIE, readCookie, sameOrigin, writeSession } from '../src/session-cookies.mjs';

const reasons = {
  invalid_credentials: '이메일 또는 비밀번호가 맞지 않습니다.',
  email_not_confirmed: '이메일 인증이 끝나지 않았습니다.',
  email_provider_disabled: '이메일 로그인이 꺼져 있습니다.',
  user_banned: '이 계정은 사용할 수 없습니다.',
  over_request_rate_limit: '요청이 너무 많습니다. 잠시 뒤 다시 시도하세요.',
};

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Vary', 'Cookie, Origin');
  const fail = (status, error) => response.status(status).json({ error });
  if (!['GET', 'POST', 'DELETE'].includes(request.method)) {
    response.setHeader('Allow', 'GET, POST, DELETE');
    return fail(405, 'METHOD_NOT_ALLOWED');
  }
  // GET may rotate refresh cookies too; the UI sends this header on every request.
  if ((request.method !== 'GET' && !sameOrigin(request))
      || request.headers['sec-fetch-site'] === 'cross-site'
      || request.headers['x-vault-request'] !== '1') return fail(403, 'ORIGIN_REQUIRED');
  const access = readCookie(request, ACCESS_COOKIE);
  const refresh = readCookie(request, REFRESH_COOKIE);
  if (request.method === 'GET' && !access && !refresh) return response.status(200).json({ signedIn: false });
  try {
    const secretKey = process.env.SUPABASE_SECRET_KEY;
    if (!secretKey || process.env.SUPABASE_URL !== new URL(config.identityProvider.issuer).origin) {
      return fail(503, 'SERVER_CONFIGURATION_INVALID');
    }
    // A new SDK client per request prevents sessions leaking between users.
    const client = createClient(process.env.SUPABASE_URL, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    const verify = createLoginVerifier({ config, supabaseSecretKey: secretKey });
    if (request.method === 'DELETE') {
      if (access) {
        const { error } = await client.auth.admin.signOut(access, 'local');
        if (error && ![401, 403, 404].includes(error.status)) return fail(503, 'LOGOUT_FAILED');
      }
      writeSession(response, null);
      return response.status(200).json({ signedIn: false });
    }
    if (request.method === 'GET') {
      const login = access && await verify(`Bearer ${access}`);
      if (login?.kind === 'student') return response.status(200).json({ signedIn: true, userId: login.userId });
      if (refresh) {
        const { data, error } = await client.auth.refreshSession({ refresh_token: refresh });
        const renewed = !error && data.session && await verify(`Bearer ${data.session.access_token}`);
        if (renewed?.kind === 'student') {
          writeSession(response, data.session);
          return response.status(200).json({ signedIn: true, userId: renewed.userId });
        }
        if (error && (!error.status || error.status >= 500)) return fail(503, 'SESSION_UNAVAILABLE');
      }
      writeSession(response, null);
      return response.status(200).json({ signedIn: false });
    }
    let input;
    try { input = typeof request.body === 'string' ? JSON.parse(request.body) : request.body; }
    catch { return fail(400, '이메일과 비밀번호를 확인하세요.'); }
    if (!input || typeof input.email !== 'string' || !input.email.trim() || input.email.length > 320
        || typeof input.password !== 'string' || !input.password || input.password.length > 4096) {
      return fail(400, '이메일과 비밀번호를 입력하세요.');
    }
    const { data, error } = await client.auth.signInWithPassword({ email: input.email.trim(), password: input.password });
    if (error || !data.session) {
      const status = error?.status === 429 ? 429 : error?.status >= 500 || !error?.status ? 503 : 401;
      return fail(status, reasons[error?.code] ?? (status === 429 ? reasons.over_request_rate_limit : status === 503 ? '인증 서버에 연결할 수 없습니다.' : '로그인에 실패했습니다.'));
    }
    const login = await verify(`Bearer ${data.session.access_token}`);
    if (login?.kind !== 'student') return fail(401, '로그인 확인에 실패했습니다.');
    writeSession(response, data.session);
    return response.status(200).json({ signedIn: true, userId: login.userId });
  } catch {
    return fail(503, 'SESSION_UNAVAILABLE');
  }
}
