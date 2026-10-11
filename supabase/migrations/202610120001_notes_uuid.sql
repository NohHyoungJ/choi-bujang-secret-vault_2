-- Keep the existing numeric primary key, memo contents, and owners intact.
begin;
alter table public.learning_notes add column if not exists note_id uuid not null default gen_random_uuid();
create unique index if not exists learning_notes_note_id_key on public.learning_notes(note_id);
commit;
