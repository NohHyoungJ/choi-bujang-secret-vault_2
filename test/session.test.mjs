import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import config from '../aleph.config.json' with { type: 'json' };
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../src/session-cookies.mjs';

test('서버 로그인·갱신·로그아웃은 토큰을 응답 본문에 노출하지 않는다', async () => {
  const originalFetch = globalThis.fetch;
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SECRET_KEY;
  const origin = new URL(config.identityProvider.issuer).origin;
  const { privateKey, publicKey } = await generateKeyPair('ES256');
  const jwk = { ...await exportJWK(publicKey), kid: 'session-test', alg: 'ES256' };
  const userId = '00000000-0000-4000-8000-000000000001';
  const token = await new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'ES256', kid: 'session-test' })
    .setSubject(userId).setIssuer(config.identityProvider.issuer).setAudience('authenticated')
    .setIssuedAt().setExpirationTime('5m').sign(privateKey);
  const user = { id: userId, aud: 'authenticated', app_metadata: {}, user_metadata: {} };
  let calls = 0;
  let refreshes = 0;
  process.env.SUPABASE_URL = origin;
  process.env.SUPABASE_SECRET_KEY = 'test-only-placeholder';
  globalThis.fetch = async (input, init = {}) => {
    calls++;
    const url = new URL(String(input));
    if (url.href === config.identityProvider.jwksUrl) return Response.json({ keys: [jwk] });
    if (url.pathname === '/auth/v1/token') {
      const input = JSON.parse(init.body);
      if (url.searchParams.get('grant_type') === 'refresh_token') refreshes++;
      else if (input.password !== 'synthetic-test-password') {
        return Response.json({ code: 'invalid_credentials', msg: 'Synthetic failure' }, {
          status: 400, headers: { 'x-supabase-api-version': '2024-01-01' },
        });
      }
      return Response.json({ access_token: token, refresh_token: 'synthetic-refresh', token_type: 'bearer', expires_in: 300, user });
    }
    if (url.pathname === '/auth/v1/logout') return new Response(null, { status: 204 });
    throw new Error('Unexpected request in test');
  };
  try {
    const { default: handler } = await import('../api/session.js');
    const invoke = async (method, body, cookie, originHeader = new URL(config.publicAppUrl).origin) => {
      const result = { headers: {} };
      await handler({ method, body, headers: { origin: originHeader,
        'x-vault-request': '1', cookie } }, {
        setHeader: (name, value) => { result.headers[name] = value; },
        status: status => { result.status = status; return { json: body => { result.body = body; } }; },
      });
      return result;
    };
    assert.deepEqual((await invoke('GET')).body, { signedIn: false });
    const before = calls;
    assert.equal((await invoke('POST', {}, undefined, 'https://cross-site.invalid')).status, 403);
    assert.equal(calls, before);
    const failed = await invoke('POST', { email: 'synthetic-user', password: 'wrong' });
    assert.equal(failed.status, 401);
    assert.match(failed.body.error, /이메일 또는 비밀번호/);
    const loggedIn = await invoke('POST', { email: 'synthetic-user', password: 'synthetic-test-password' });
    assert.equal(loggedIn.status, 200);
    assert.deepEqual(loggedIn.body, { signedIn: true, userId });
    assert.equal(loggedIn.headers['Set-Cookie'].length, 2);
    for (const cookie of loggedIn.headers['Set-Cookie']) {
      assert.match(cookie, /HttpOnly; Secure; SameSite=Strict/);
      assert.doesNotMatch(cookie, /Domain=/);
    }
    const cookies = loggedIn.headers['Set-Cookie'].map(cookie => cookie.split(';')[0]).join('; ');
    assert.deepEqual((await invoke('GET', undefined, cookies)).body, { signedIn: true, userId });
    const renewed = await invoke('GET', undefined, `${ACCESS_COOKIE}=invalid; ${REFRESH_COOKIE}=synthetic-refresh`);
    assert.deepEqual(renewed.body, { signedIn: true, userId });
    assert.equal(refreshes, 1);
    assert.equal(renewed.headers['Set-Cookie'].length, 2);
    const logout = await invoke('DELETE', undefined, cookies);
    assert.deepEqual(logout.body, { signedIn: false });
    for (const cookie of logout.headers['Set-Cookie']) assert.match(cookie, /Max-Age=0/);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = previousKey;
  }
});
