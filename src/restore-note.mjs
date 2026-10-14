import { createHash } from 'node:crypto';

export const NOTE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = code => { throw new Error(code); };
export const noteContentHash = ({ title, body }) => hash(JSON.stringify({ title, body }));

export function verifiedBackupNote({ backupText, trustedBackupSha256, id, ownerId }) {
  if (typeof backupText !== 'string' || !backupText || backupText.length > 1024 * 1024
      || !/^[a-f0-9]{64}$/u.test(trustedBackupSha256 ?? '')) fail('RESTORE_BACKUP_MISSING');
  if (hash(backupText) !== trustedBackupSha256) fail('RESTORE_BACKUP_INVALID');
  let backup;
  try { backup = JSON.parse(backupText); } catch { fail('RESTORE_BACKUP_INVALID'); }
  if (backup?.schema !== 'aleph.synthetic-note-backup.v1' || backup.environment !== 'test'
      || !Array.isArray(backup.notes) || backup.notes.length > 100) fail('RESTORE_BACKUP_INVALID');
  const matches = backup.notes.filter(note => note?.id === id);
  if (matches.length !== 1) fail('RESTORE_TARGET_NOT_FOUND');
  const note = matches[0];
  if (Object.keys(note).sort().join(',') !== 'body,contentSha256,id,ownerId,title'
      || typeof note.id !== 'string' || typeof note.ownerId !== 'string'
      || !NOTE_ID.test(note.id) || !NOTE_ID.test(note.ownerId)
      || note.ownerId !== ownerId) fail('RESTORE_OWNER_MISMATCH');
  if (typeof note.title !== 'string' || !note.title.trim() || note.title.length > 200
      || typeof note.body !== 'string' || !note.body.trim() || note.body.length > 20000
      || noteContentHash(note) !== note.contentSha256) fail('RESTORE_CONTENT_HASH_MISMATCH');
  return { id: note.id, ownerId: note.ownerId, title: note.title, body: note.body,
    contentSha256: note.contentSha256 };
}

export async function restoreOneNote(supabase, note) {
  const table = () => supabase.from('learning_notes');
  const existing = await table().select('note_id,owner_id').eq('note_id', note.id).maybeSingle();
  if (existing.error) fail('RESTORE_DATABASE_UNAVAILABLE');
  if (existing.data && existing.data.owner_id !== note.ownerId) fail('RESTORE_OWNER_MISMATCH');
  const columns = 'note_id,owner_id,title,content';
  let result;
  if (existing.data) {
    result = await table().update({ title: note.title, content: note.body })
      .eq('note_id', note.id).eq('owner_id', note.ownerId).select(columns).maybeSingle();
  } else {
    // upsert 금지: 다른 소유자의 충돌 행을 덮어쓰지 않습니다.
    result = await table().insert({ note_id: note.id, owner_id: note.ownerId,
      title: note.title, content: note.body }).select(columns).maybeSingle();
  }
  if (result.error) fail(result.error.code === '23505' ? 'RESTORE_CONFLICT' : 'RESTORE_DATABASE_UNAVAILABLE');
  const row = result.data;
  if (!row || row.note_id !== note.id || row.owner_id !== note.ownerId
      || noteContentHash({ title: row.title, body: row.content }) !== note.contentSha256) {
    fail('RESTORE_RESULT_MISMATCH');
  }
  return { restored: true, verification: { idMatches: true, ownerMatches: true, contentHashMatches: true } };
}
