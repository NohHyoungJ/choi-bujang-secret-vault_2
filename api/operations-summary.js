import { randomUUID } from 'node:crypto';
import config from '../aleph.config.json' with { type: 'json' };
import { RULE_IDS } from '../src/decider.mjs';
import { createLoginVerifier } from '../src/verify-login.mjs';
import { ACCESS_COOKIE, readCookie } from '../src/session-cookies.mjs';
import { readDeviceApproval } from '../src/device-approval.mjs';
import { unexecutedVerification } from '../public/verification-plan.mjs';

let verifier;
const verify = authorization => {
  verifier ??= createLoginVerifier({ config, supabaseSecretKey: process.env.SUPABASE_SECRET_KEY });
  return verifier(authorization);
};

// One redacted snapshot feeds both the API and the server log. No note/identity fields.
export function createOperationsHandler({ verifyLogin = verify, readApproval = readDeviceApproval,
  writeRecord = record => console.info(`operations_summary:${JSON.stringify(record)}`) } = {}) {
  return async (request, response) => {
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Vary', 'Authorization, Cookie, Origin');
    const fail = (status, error) => response.status(status).json({ error });
    const url = new URL(request.url ?? '/api/operations-summary', 'https://local.invalid');
    if (url.pathname !== '/api/operations-summary' || url.search) return fail(404, 'NOT_FOUND');
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      return fail(405, 'METHOD_NOT_ALLOWED');
    }
    if (request.headers?.['sec-fetch-site'] === 'cross-site'
        || request.headers?.['x-vault-request'] !== '1') return fail(403, 'ORIGIN_REQUIRED');
    const cookie = readCookie(request, ACCESS_COOKIE);
    const authorization = request.headers?.authorization ?? (cookie ? `Bearer ${cookie}` : undefined);
    if (!authorization) return fail(401, 'LOGIN_REQUIRED');
    try {
      const login = await verifyLogin(authorization);
      if (!login) return fail(401, 'LOGIN_REQUIRED');
      const approval = await readApproval(login);
      if (approval.status === 'unavailable') return fail(503, 'DEVICE_APPROVAL_UNAVAILABLE');
      if (approval.status !== 'approved' || approval.deviceRegistered !== true) {
        return fail(403, 'DEVICE_NOT_REGISTERED');
      }
      const snapshot = {
        schema: 'vault.operations-summary.v1', recordId: randomUUID(), at: new Date().toISOString(),
        rules: { status: 'server_code_confirmed', count: RULE_IDS.length, names: [...RULE_IDS],
          runtime: 'unconnected' },
        detection: { status: 'unconnected', eventCount: null },
        revocation: { status: 'unconnected', proposedCount: null, completedCount: null },
        recovery: { status: 'unconnected', currentVersion: null, restoredVersion: null },
        verification: unexecutedVerification(),
      };
      // If the server record cannot be emitted, do not return an apparently auditable result.
      await writeRecord(structuredClone(snapshot));
      return response.status(200).json(snapshot);
    } catch { return fail(503, 'OPERATIONS_SUMMARY_UNAVAILABLE'); }
  };
}

export default createOperationsHandler();
