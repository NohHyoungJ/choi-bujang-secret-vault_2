import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import config from '../aleph.config.json' with { type: 'json' };
import { noteContentHash } from '../src/restore-note.mjs';

// 합성 B 계정과 합성 사본으로만 복원합니다. 실제 계정·토큰·DB·서명 키는 사용하지 않습니다.
test('POST 한 건 복원은 B의 ID·소유자·내용 해시와 다른 메모·감사 보존을 확인한다', async () => {
  const a = '00000000-0000-4000-8000-000000000001';
  const b = '00000000-0000-4000-8000-000000000002';
  const target = '00000000-0000-4000-8000-000000000003';
  const other = '00000000-0000-4000-8000-000000000004';
  const note = { id: target, ownerId: b, title: 'Synthetic B', body: 'Synthetic fixture only' };
  note.contentSha256 = noteContentHash(note);
  const otherRow = { note_id: other, owner_id: a, title: 'Synthetic other', content: 'Synthetic unchanged' };
  const state = { rows: new Map([[other, structuredClone(otherRow)]]), writes: 0,
    audits: [{ action: 'synthetic_existing_audit' }], logs: [] };
  state.client = { from(table) {
    assert.equal(table, 'learning_notes', '감사 테이블과 다른 서비스에는 접근하지 않음');
    const filters = {};
    let operation = 'GET';
    let payload;
    const builder = {
      select() { return this; }, eq(key, value) { filters[key] = value; return this; },
      maybeSingle() { return this; },
      insert(value) { operation = 'POST'; payload = value; return this; },
      update(value) { operation = 'PUT'; payload = value; return this; },
      then(resolve, reject) {
        let data;
        let error = null;
        if (operation === 'POST') {
          assert.equal(payload.owner_id, b);
          assert.equal(payload.note_id, target);
          if (state.rows.has(payload.note_id)) error = { code: '23505' };
          else { state.writes++; state.rows.set(payload.note_id, { id: 99, created_at: 'synthetic-created', ...payload });
            data = state.rows.get(payload.note_id); }
        } else {
          const row = state.rows.get(filters.note_id);
          data = row && (!filters.owner_id || row.owner_id === filters.owner_id) ? row : null;
          if (operation === 'PUT' && data) {
            assert.equal(filters.owner_id, b);
            assert.equal(filters.note_id, target);
            assert.deepEqual(Object.keys(payload).sort(), ['content', 'title']);
            state.writes++;
            Object.assign(data, payload);
          }
        }
        return Promise.resolve({ data: data ? structuredClone(data) : null, error }).then(resolve, reject);
      },
    };
    return builder;
  } };
  const key = Symbol.for('vault-restore-note-test');
  globalThis[key] = state;
  const dataUrl = text => `data:text/javascript,${encodeURIComponent(text)}`;
  const hook = registerHooks({ resolve(specifier, context, next) {
    // Restore authorization cases start after a virtual approval check.
    if (specifier.endsWith('/src/device-approval.mjs')) return { shortCircuit: true, url: dataUrl(
      'export async function readDeviceApproval(){return {status:"approved",deviceRegistered:true};}') };
    if (specifier === '@supabase/supabase-js') return { shortCircuit: true, url: dataUrl(
      'export function createClient(){return globalThis[Symbol.for("vault-restore-note-test")].client;}') };
    if (specifier.endsWith('/src/verify-login.mjs')) return { shortCircuit: true, url: dataUrl(
      `export function createLoginVerifier(){return async value=>['fixture-B','Bearer fixture-B'].includes(value)?{userId:'${b}'}:value==='fixture-A'?{userId:'${a}'}:null;}`) };
    return next(specifier, context);
  } });
  const keys = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'NOTE_RESTORE_TEST_SUBJECT_ID',
    'NOTE_RESTORE_BACKUP_JSON', 'NOTE_RESTORE_BACKUP_SHA256'];
  const previous = keys.map(key => process.env[key]);
  const logInfo = console.info;
  const logWarn = console.warn;
  console.info = value => state.logs.push(value);
  console.warn = value => state.logs.push(value);
  const setBackup = record => {
    process.env.NOTE_RESTORE_BACKUP_JSON = JSON.stringify({ schema: 'aleph.synthetic-note-backup.v1',
      environment: 'test', notes: [record] });
    process.env.NOTE_RESTORE_BACKUP_SHA256 = createHash('sha256')
      .update(process.env.NOTE_RESTORE_BACKUP_JSON).digest('hex');
  };
  process.env.SUPABASE_URL = new URL(config.identityProvider.issuer).origin;
  process.env.SUPABASE_SECRET_KEY = 'synthetic-placeholder';
  process.env.NOTE_RESTORE_TEST_SUBJECT_ID = b;
  setBackup(note);
  try {
    const { default: handler } = await import('../api/restore-note.js');
    const invoke = async ({ auth = 'fixture-B', body = { id: target }, method = 'POST',
      origin = new URL(config.publicAppUrl).origin, cookie } = {}) => {
      const result = { headers: {} };
      await handler({ url: '/api/restore-note', method, body, headers: { authorization: auth ?? undefined, origin, cookie } }, {
        setHeader(key, value) { result.headers[key] = value; },
        status(status) { result.status = status; return { json(value) { result.body = value; } }; },
      });
      return result;
    };
    const audits = structuredClone(state.audits);
    const first = await invoke();
    assert.equal(first.status, 200);
    assert.deepEqual(first.body.verification, { idMatches: true, ownerMatches: true, contentHashMatches: true });
    const restored = state.rows.get(target);
    assert.equal(restored.note_id, note.id);
    assert.equal(restored.owner_id, note.ownerId);
    assert.equal(noteContentHash({ title: restored.title, body: restored.content }), note.contentSha256);
    restored.content = 'Synthetic damaged B';
    assert.equal((await invoke()).status, 200);
    assert.equal(state.rows.get(target).id, 99);
    assert.equal(state.rows.get(target).created_at, 'synthetic-created');
    assert.deepEqual(state.rows.get(other), otherRow);
    assert.deepEqual(state.audits, audits);
    const writes = state.writes;
    assert.equal((await invoke({ auth: 'fixture-A' })).status, 403);
    assert.equal((await invoke({ auth: 'synthetic-invalid' })).status, 401);
    assert.equal((await invoke({ body: { id: target, owner_id: a, role: 'instructor' } })).status, 400);
    assert.equal((await invoke({ method: 'GET' })).status, 405);
    assert.equal((await invoke({ auth: null, cookie: '__Host-vault-access=fixture-B',
      origin: 'https://cross-site.invalid' })).status, 403);
    setBackup({ ...note, body: 'Synthetic tampered B' });
    assert.equal((await invoke()).status, 422);
    setBackup({ ...note, ownerId: a });
    assert.equal((await invoke()).status, 409);
    setBackup(note);
    state.rows.set(target, { ...restored, owner_id: a });
    assert.equal((await invoke()).status, 409, '다른 소유자의 충돌 행을 덮어쓰지 않음');
    assert.equal(state.writes, writes);
    assert.deepEqual(state.audits, audits);
    assert.ok(state.logs.includes('restore_note:completed'));
    for (const logged of state.logs) assert.match(logged, /^restore_note:(?:completed|[A-Z_]+)$/u);
    delete process.env.NOTE_RESTORE_BACKUP_JSON;
    assert.equal((await invoke()).status, 503);
  } finally {
    console.info = logInfo;
    console.warn = logWarn;
    keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
    hook.deregister();
    delete globalThis[key];
  }
});
