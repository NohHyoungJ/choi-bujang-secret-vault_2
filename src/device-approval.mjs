import { createClient } from '@supabase/supabase-js';
import config from '../aleph.config.json' with { type: 'json' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
export const APPROVAL_SCHEMA = 'vault.test-device-approval.v1';

// Test-site model: one verified Auth session is a virtual device, not hardware attestation.
// Only server-verified claims enter this function. Request body/header IDs are never used.
export function approvalClient() {
  const origin = new URL(config.identityProvider.issuer).origin;
  if (process.env.SUPABASE_URL !== origin || !process.env.SUPABASE_SECRET_KEY) {
    throw new Error('DEVICE_APPROVAL_UNAVAILABLE');
  }
  return createClient(origin, process.env.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

export async function readDeviceApproval(login, { client, requestApproval = false } = {}) {
  const result = (status, requestId = null) => ({ schema: APPROVAL_SCHEMA,
    mode: 'test_session', status, deviceRegistered: status === 'approved', requestId });
  if (login?.kind !== 'student' || !UUID.test(login.userId ?? '') || !UUID.test(login.sessionId ?? '')) {
    return result('unavailable');
  }
  client ??= approvalClient();
  if (requestApproval) {
    // Repeated requests cannot overwrite approval, revocation, or expiration.
    const { error } = await client.from('vault_test_device_approvals').upsert({
      user_id: login.userId, session_id: login.sessionId,
    }, { onConflict: 'user_id,session_id', ignoreDuplicates: true });
    if (error) throw new Error('DEVICE_APPROVAL_UNAVAILABLE');
  }
  const { data, error } = await client.from('vault_test_device_approvals')
    .select('request_id,user_id,session_id,state,approved_until')
    .eq('user_id', login.userId).eq('session_id', login.sessionId).maybeSingle();
  if (error) throw new Error('DEVICE_APPROVAL_UNAVAILABLE');
  if (!data) return result('unregistered');
  if (!UUID.test(data.request_id ?? '') || data.user_id !== login.userId
      || data.session_id !== login.sessionId || !['pending', 'approved', 'revoked'].includes(data.state)) {
    throw new Error('DEVICE_APPROVAL_UNAVAILABLE');
  }
  if (data.state === 'approved') {
    const until = typeof data.approved_until === 'string' ? Date.parse(data.approved_until) : NaN;
    if (!Number.isFinite(until) || until <= Date.now()) return result('expired', data.request_id);
  }
  return result(data.state, data.request_id);
}
