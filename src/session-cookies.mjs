import config from '../aleph.config.json' with { type: 'json' };

export const ACCESS_COOKIE = '__Host-vault-access';
export const REFRESH_COOKIE = '__Host-vault-refresh';

export function readCookie(request, name) {
  const raw = request.headers?.cookie;
  if (typeof raw !== 'string') return null;
  const values = raw.split(';').map(value => value.trim()).filter(value => value.startsWith(`${name}=`));
  if (values.length !== 1) return null;
  try { return decodeURIComponent(values[0].slice(name.length + 1)); } catch { return null; }
}

export function sameOrigin(request) {
  // Use the configured production origin, never an untrusted Host header.
  return request.headers?.origin === new URL(config.publicAppUrl).origin
    && request.headers?.['sec-fetch-site'] !== 'cross-site';
}

export function writeSession(response, session) {
  const cookie = (name, value) => `${name}=${encodeURIComponent(value ?? '')}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${session ? 604800 : 0}`;
  response.setHeader('Set-Cookie', [cookie(ACCESS_COOKIE, session?.access_token),
    cookie(REFRESH_COOKIE, session?.refresh_token)]);
}
