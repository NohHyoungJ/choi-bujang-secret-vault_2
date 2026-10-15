import config from '../aleph.config.json' with { type: 'json' };
import { createLoginVerifier } from '../src/verify-login.mjs';
import { ACCESS_COOKIE, readCookie, sameOrigin } from '../src/session-cookies.mjs';
import { readDeviceApproval } from '../src/device-approval.mjs';

let verifier;
export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Vary', 'Authorization, Cookie, Origin');
  const fail = (status, error) => response.status(status).json({ error });
  const url = new URL(request.url ?? '/api/device-approval', 'https://local.invalid');
  if (url.pathname !== '/api/device-approval' || url.search) return fail(404, 'NOT_FOUND');
  if (!['GET', 'POST'].includes(request.method)) {
    response.setHeader('Allow', 'GET, POST');
    return fail(405, 'METHOD_NOT_ALLOWED');
  }
  if (request.headers?.['sec-fetch-site'] === 'cross-site'
      || request.headers?.['x-vault-request'] !== '1'
      || (request.method === 'POST' && !sameOrigin(request))) return fail(403, 'ORIGIN_REQUIRED');
  const cookie = readCookie(request, ACCESS_COOKIE);
  const authorization = request.headers?.authorization ?? (cookie ? `Bearer ${cookie}` : undefined);
  if (!authorization) return fail(401, 'LOGIN_REQUIRED');
  if (request.method === 'POST') {
    let input;
    try { input = typeof request.body === 'string' ? JSON.parse(request.body) : request.body; }
    catch { return fail(400, 'INVALID_APPROVAL_REQUEST'); }
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 0) {
      return fail(400, 'INVALID_APPROVAL_REQUEST');
    }
  }
  try {
    verifier ??= createLoginVerifier({ config, supabaseSecretKey: process.env.SUPABASE_SECRET_KEY });
    const login = await verifier(authorization);
    if (!login) return fail(401, 'LOGIN_REQUIRED');
    const approval = await readDeviceApproval(login, { requestApproval: request.method === 'POST' });
    if (approval.status === 'unavailable') return fail(503, 'DEVICE_APPROVAL_UNAVAILABLE');
    return response.status(200).json(approval);
  } catch { return fail(503, 'DEVICE_APPROVAL_UNAVAILABLE'); }
}
