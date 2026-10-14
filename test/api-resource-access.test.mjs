import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import config from '../aleph.config.json' with { type: 'json' };

// 실제 계정·토큰·서명 키·DB 없이 API 권한 분기만 시험합니다.
test('직접 API 요청의 저장된 소유자·강사 권한과 구역 격리', async () => {
  const a = '00000000-0000-4000-8000-000000000001';
  const b = '00000000-0000-4000-8000-000000000002';
  const noteId = '00000000-0000-4000-8000-000000000003';
  const state = { rows: [{ note_id: noteId, owner_id: a, title: 'Synthetic', content: 'Synthetic' }],
    bypassOwner: false, role: null, userRole: 'instructor', storedId: b, lookupFailure: false,
    queries: 0, lookups: 0, logins: new Map([['fixture-A', { userId: a }], ['fixture-B', { userId: b }]]) };
  state.client = {
    auth: { admin: { async getUserById(id) {
      state.lookups++;
      assert.equal(id, b);
      if (state.lookupFailure) throw new Error('Synthetic unavailable');
      return { data: { user: { id: state.storedId, app_metadata: { role: state.role },
        user_metadata: { role: state.userRole } } }, error: null };
    } } },
    from(table) {
      state.queries++;
      assert.equal(table, 'learning_notes');
      const filters = {};
      let single = false;
      let operation = 'GET';
      let patch;
      const builder = {
        select(columns) { assert.ok(columns.includes('owner_id')); return this; },
        eq(column, value) { filters[column] = value; return this; },
        order() { return this; },
        maybeSingle() { single = true; return this; },
        update(value) { operation = 'PUT'; patch = value; return this; },
        delete() { operation = 'DELETE'; return this; },
        then(resolve, reject) {
          assert.ok(filters.owner_id, 'DB 요청에 검증된 소유자 필터 필수');
          const rows = state.rows.filter(row => (state.bypassOwner || row.owner_id === filters.owner_id)
            && (!filters.note_id || row.note_id === filters.note_id));
          if (operation === 'PUT') rows.forEach(row => Object.assign(row, patch));
          if (operation === 'DELETE') state.rows = state.rows.filter(row => !rows.includes(row));
          return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  const key = Symbol.for('vault-api-resource-test');
  globalThis[key] = state;
  const moduleUrl = source => `data:text/javascript,${encodeURIComponent(source)}`;
  const hook = registerHooks({ resolve(specifier, context, nextResolve) {
    if (specifier === '@supabase/supabase-js') return { shortCircuit: true, url: moduleUrl(
      'export function createClient(){return globalThis[Symbol.for("vault-api-resource-test")].client;}') };
    if (specifier.endsWith('/src/verify-login.mjs')) return { shortCircuit: true, url: moduleUrl(
      'export function createLoginVerifier(){return async value=>globalThis[Symbol.for("vault-api-resource-test")].logins.get(value)??null;}') };
    return nextResolve(specifier, context);
  } });
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SECRET_KEY;
  process.env.SUPABASE_URL = new URL(config.identityProvider.issuer).origin;
  process.env.SUPABASE_SECRET_KEY = 'synthetic-placeholder';
  try {
    const { default: handler } = await import('../api/learning-notes.js');
    const invoke = async (url, authorization, method = 'GET', body = {}) => {
      const result = { headers: {} };
      await handler({ url, method, headers: { authorization, role: 'instructor' }, body }, {
        setHeader(name, value) { result.headers[name] = value; },
        status(code) { result.status = code; return { json(value) { result.body = value; } }; },
      });
      return result;
    };
    assert.equal((await invoke(`/api/learning-notes/${noteId}`, 'fixture-A')).status, 200);
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const result = await invoke(`/api/learning-notes/${noteId}?role=instructor&owner_id=${a}`,
        'fixture-B', method, { title: 'Synthetic', body: 'Synthetic', role: 'instructor' });
      assert.equal(result.status, 404);
      assert.deepEqual(result.body, { error: 'NOTE_NOT_FOUND' });
      const normal = await invoke(`/api/learning-notes/${noteId}`, 'fixture-A');
      assert.equal(normal.status, 200, 'B 요청 거부 뒤에도 A의 정상 조회 유지');
      assert.equal(normal.body.id, noteId);
      assert.equal(normal.body.title, 'Synthetic', 'B의 수정·삭제가 A의 자료에 영향을 주지 않음');
    }
    assert.equal(state.rows[0].owner_id, a);
    state.bypassOwner = true;
    assert.equal((await invoke(`/api/learning-notes/${noteId}`, 'fixture-B')).status, 404);
    assert.equal((await invoke('/api/learning-notes', 'fixture-B')).status, 403);
    state.bypassOwner = false;
    assert.deepEqual((await invoke('/api/learning-notes', 'fixture-B')).body, []);
    const before = state.queries;
    assert.equal((await invoke('/api/instructor-notices', 'fixture-B', 'POST', { role: 'instructor' })).status, 405);
    assert.equal((await invoke('/api/instructor-notices', 'fixture-B')).status, 501);
    assert.equal((await invoke('/api/instructor-materials')).status, 401);
    for (const [path, method] of [['/api/instructor-materials', 'GET'],
      ['/api/admin/instructor-notices', 'POST'], [`/api/admin/instructor-notices/${noteId}`, 'PATCH']]) {
      assert.equal((await invoke(path, 'fixture-B', method, { role: 'instructor' })).status, 403);
      state.role = 'instructor';
      assert.equal((await invoke(path, 'fixture-B', method)).status, 501);
      state.role = null;
      assert.equal((await invoke(path, 'fixture-B', method)).status, 403, '역할 회수 즉시 반영');
    }
    state.role = 'instructor';
    state.storedId = a;
    assert.equal((await invoke('/api/instructor-materials', 'fixture-B')).status, 403);
    state.lookupFailure = true;
    assert.equal((await invoke('/api/instructor-materials', 'fixture-B')).status, 503);
    assert.equal(state.queries, before, '다른 구역 요청은 메모 DB에 접근하지 않음');
    assert.ok(state.lookups > 0);
    assert.equal((await invoke('/api/unknown', 'fixture-A')).status, 404);
  } finally {
    hook.deregister();
    delete globalThis[key];
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = oldKey;
  }
});
