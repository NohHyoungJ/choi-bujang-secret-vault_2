create table public.vault_test_device_approvals (
  request_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references auth.sessions(id) on delete cascade,
  state text not null default 'pending' check (state in ('pending', 'approved', 'revoked')),
  requested_at timestamptz not null default now(),
  approved_until timestamptz,
  unique (user_id, session_id),
  check (state <> 'approved' or approved_until is not null)
);
create index vault_test_device_approvals_session_idx on public.vault_test_device_approvals(session_id);
alter table public.vault_test_device_approvals enable row level security;
revoke all on table public.vault_test_device_approvals from public, anon, authenticated, service_role;
grant select on table public.vault_test_device_approvals to service_role;
grant insert (user_id, session_id) on table public.vault_test_device_approvals to service_role;
comment on table public.vault_test_device_approvals is 'Test-only approval of verified Auth sessions as virtual devices. No hardware attestation. Only database administrators approve or revoke.';
