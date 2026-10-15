import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import config from '../aleph.config.json' with { type: 'json' };

test('자료 API는 검증된 토큰만 허용하고 브라우저의 userId·role을 무시한다', async () => {
  const originalFetch = globalThis.fetch;
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SECRET_KEY;
  const origin = new URL(config.identityProvider.issuer).origin;
  // Disposable test keys and synthetic identities only; no real account or DB access.
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwk = { ...await exportJWK(publicKey), kid: 'auth-test', alg: 'ES256', use: 'sig' };
  let databaseReads = 0;
  const rows = new Map();
  process.env.SUPABASE_URL = origin;
  process.env.SUPABASE_SECRET_KEY = 'test-only-placeholder';
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));
    if (url.href === config.identityProvider.jwksUrl) {
      return Response.json({ keys: [jwk] });
    }
    if (url.origin === origin && url.pathname === '/rest/v1/vault_test_device_approvals') {
      // Existing CRUD cases use an explicitly approved synthetic session, never a real device.
      return Response.json({ request_id: '00000000-0000-4000-8000-000000000004',
        user_id: url.searchParams.get('user_id')?.replace(/^eq\./, ''),
        session_id: url.searchParams.get('session_id')?.replace(/^eq\./, ''),
        state: 'approved', approved_until: new Date(Date.now() + 60000).toISOString() });
    }
    if (url.origin === origin && url.pathname === '/rest/v1/learning_notes') {
      databaseReads++;
      const method = init.method ?? 'GET';
      const id = url.searchParams.get('note_id')?.replace(/^eq\./, '');
      const headers = new Headers(init.headers);
      if (method === 'POST') {
        const row = JSON.parse(init.body);
        if (rows.has(row.note_id)) return Response.json({ code: '23505' }, { status: 409 });
        rows.set(row.note_id, row);
        return new Response(null, { status: 201 });
      }
      const candidate = rows.get(id);
      const owner = url.searchParams.get('owner_id');
      assert.ok(owner, 'All reads, updates and deletes must have a server-side owner filter');
      const found = candidate && `eq.${candidate.owner_id}` === owner ? candidate : undefined;
      if (method === 'PATCH' && found) {
        const patch = JSON.parse(init.body);
        assert.equal(`eq.${patch.owner_id}`, owner, 'The new row must retain the verified owner');
        Object.assign(found, patch);
      }
      if (method === 'DELETE' && found) rows.delete(id);
      let data = id ? (found ? [found] : []) : [...rows.values()].filter(row =>
        `eq.${row.owner_id}` === url.searchParams.get('owner_id'));
      if (headers.get('accept')?.includes('vnd.pgrst.object')) data = data[0] ?? null;
      return Response.json(data);
    }
    throw new Error('Unexpected outbound request in local test');
  };
  try {
    const { default: handler } = await import('../api/learning-notes.js');
    const invoke = async (authorization, method = 'GET', id, input, extraHeaders = {}) => {
      let status;
      let body;
      const headers = {};
      await handler({ method, url: `/api/learning-notes${id ? `/${id}` : ''}?owner_id=untrusted`, headers: { authorization, userId: 'untrusted', role: 'admin', ...extraHeaders },
        query: { userId: 'untrusted', role: 'admin' }, body: input ?? { userId: 'untrusted', role: 'admin' } }, {
        setHeader: (name, value) => { headers[name] = value; },
        status: code => { status = code; return { json: value => { body = value; } }; },
      });
      return { status, body, headers };
    };
    const denied = async authorization => {
      const before = databaseReads;
      const result = await invoke(authorization);
      assert.equal(result.status, 401);
      assert.deepEqual(result.body, { error: 'LOGIN_REQUIRED' });
      assert.equal(databaseReads, before, 'Rejected requests must not read the DB');
    };
    await denied(undefined);
    await denied('Bearer invalid');
    const sign = (key, overrides = {}) => new SignJWT({
      role: 'authenticated', session_id: '00000000-0000-4000-8000-000000000005', ...overrides,
    }).setProtectedHeader({ alg: 'ES256', kid: 'auth-test' })
      .setIssuer(config.identityProvider.issuer)
      .setAudience(config.identityProvider.audience)
      .setSubject('00000000-0000-4000-8000-000000000001')
      .setIssuedAt().setExpirationTime('5m').sign(key);
    const valid = await sign(privateKey);
    const result = await invoke(`Bearer ${valid}`);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, []);
    assert.equal(databaseReads, 1);
    const other = await generateKeyPair('ES256');
    await denied(`Bearer ${await sign(other.privateKey)}`);
    await denied(`Bearer ${await sign(privateKey, { role: 'anon' })}`);
    assert.equal((await invoke(`Bearer ${valid}`)).status, 200, 'Normal login still works after rejections');
    const auth = `Bearer ${valid}`;
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const before = databaseReads;
      const denied = await invoke(undefined, method, method === 'POST' ? undefined : '00000000-0000-4000-8000-000000000002');
      assert.equal(denied.status, 401);
      assert.equal(databaseReads, before);
    }
    const created = await invoke(auth, 'POST', undefined, { title: 'Synthetic test', body: 'Synthetic body', owner_id: 'untrusted' });
    assert.equal(created.status, 201);
    assert.match(created.body.id, /^[a-f0-9-]{36}$/i);
    const id = created.body.id;
    assert.equal(rows.get(id).owner_id, '00000000-0000-4000-8000-000000000001');
    const cookieHeaders = { cookie: `__Host-vault-access=${valid}`, origin: new URL(config.publicAppUrl).origin };
    assert.equal((await invoke(undefined, 'GET', id, undefined, cookieHeaders)).status, 200);
    assert.equal((await invoke(undefined, 'PUT', id, { title: 'Cookie update', body: 'Synthetic' }, cookieHeaders)).status, 200);
    const beforeCsrf = databaseReads;
    assert.equal((await invoke(undefined, 'DELETE', id, undefined, { ...cookieHeaders, origin: 'https://cross-site.invalid' })).status, 403);
    assert.equal(databaseReads, beforeCsrf);
    assert.deepEqual((await invoke(auth, 'GET', id)).body, { id, title: 'Cookie update', body: 'Synthetic' });
    assert.equal((await invoke(auth)).body.length, 1);
    assert.equal((await invoke(auth, 'PUT', id, { title: 'Updated', body: 'Changed' })).status, 200);
    // B must not access A's note, even with its exact UUID.
    const b = await new SignJWT({ role: 'authenticated', session_id: '00000000-0000-4000-8000-000000000006' }).setProtectedHeader({ alg: 'ES256', kid: 'auth-test' })
      .setIssuer(config.identityProvider.issuer).setAudience(config.identityProvider.audience)
      .setSubject('00000000-0000-4000-8000-000000000002').setIssuedAt().setExpirationTime('5m').sign(privateKey);
    assert.deepEqual((await invoke(`Bearer ${b}`)).body, []);
    const bAuth = `Bearer ${b}`;
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const denied = await invoke(bAuth, method, id, { title: 'B edit', body: 'Synthetic' });
      assert.equal(denied.status, 404);
      assert.deepEqual(denied.body, { error: 'NOTE_NOT_FOUND' });
    }
    assert.equal((await invoke(auth, 'GET', id)).body.title, 'Updated');
    const beforeChange = databaseReads;
    assert.equal((await invoke(auth, 'PUT', id, { title: 'Transfer', body: 'Synthetic',
      owner_id: '00000000-0000-4000-8000-000000000002' })).status, 400);
    assert.equal(databaseReads, beforeChange, 'Owner changes are rejected before DB access');
    assert.equal(rows.get(id).owner_id, '00000000-0000-4000-8000-000000000001');
    const bCreated = await invoke(bAuth, 'POST', undefined, { title: 'B note', body: 'Synthetic',
      owner_id: '00000000-0000-4000-8000-000000000001' });
    assert.equal(bCreated.status, 201);
    const bId = bCreated.body.id;
    assert.equal(rows.get(bId).owner_id, '00000000-0000-4000-8000-000000000002');
    assert.deepEqual((await invoke(bAuth, 'GET', bId)).body, { id: bId, title: 'B note', body: 'Synthetic' });
    for (const method of ['GET', 'PUT', 'DELETE']) {
      assert.equal((await invoke(auth, method, bId, { title: 'A edit', body: 'Synthetic' })).status, 404);
    }
    assert.equal((await invoke(bAuth)).body.length, 1);
    assert.equal((await invoke(auth)).body.length, 1);
    assert.equal((await invoke(bAuth, 'PUT', bId, { title: 'B updated', body: 'Changed' })).status, 200);
    assert.equal((await invoke(bAuth, 'PUT', bId, { title: 'Transfer', body: 'Synthetic',
      owner_id: '00000000-0000-4000-8000-000000000001' })).status, 400);
    assert.equal((await invoke(bAuth, 'DELETE', bId)).status, 200);
    assert.equal((await invoke(bAuth, 'GET', bId)).status, 404);
    assert.equal((await invoke(auth, 'DELETE', id)).status, 200);
    assert.equal((await invoke(auth, 'GET', id)).status, 404);
    const explicit = '00000000-0000-4000-8000-000000000003';
    assert.deepEqual((await invoke(auth, 'POST', undefined, { id: explicit, title: 'Explicit', body: 'Synthetic' })).body, { id: explicit });
    assert.equal((await invoke(auth, 'POST', undefined, { id: explicit, title: 'Explicit', body: 'Synthetic' })).status, 409);
    assert.equal((await invoke(auth, 'POST', undefined, { id: 'bad', title: 'Title', body: 'Body' })).status, 400);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = previousKey;
  }
});
