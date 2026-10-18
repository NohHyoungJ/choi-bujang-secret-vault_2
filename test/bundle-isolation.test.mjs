import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runAttackChecks } from '../src/attack-check.mjs';

test('bundle checks use public HTTPS GET/HEAD only and mark writes not_run without timeout APIs', async () => {
  const originalFetch = globalThis.fetch;
  const originalAbort = globalThis.AbortSignal;
  const config = JSON.parse(readFileSync(new URL('../aleph.config.json', import.meta.url)));
  const calls = [];
  try {
    globalThis.AbortSignal = undefined;
    globalThis.fetch = async (url, options = {}) => {
      const target = new URL(url);
      assert.equal(target.protocol, 'https:');
      assert(['GET', 'HEAD'].includes(options.method ?? 'GET'));
      assert.equal(options.body, undefined);
      calls.push(target.href);
      if (target.pathname === '/data.json') return new Response(JSON.stringify({ notes: [] }), { status: 200 });
      if (target.pathname === '/aleph.json') return new Response('{}', { status: 200 });
      return new Response(JSON.stringify({ error: 'LOGIN_REQUIRED' }), { status: 401 });
    };
    for (const step of [3, 8, 10, 11, 12]) {
      const results = await runAttackChecks({ ...config, step });
      for (const id of ['anonymous_create', 'anonymous_update', 'anonymous_delete']) {
        assert.equal(results.find(row => row.attackId === id).observed, 'not_run');
      }
      if (step === 8) assert.equal(results.find(row => row.attackId === 'direct_notice_write').observed, 'not_run');
      if (step === 10) assert.equal(results.find(row => row.attackId === 'anonymous_restore_note').observed, 'not_run');
      assert(results.some(row => row.observed.startsWith('HTTP ')));
    }
    assert(calls.length > 0);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.AbortSignal = originalAbort;
  }
});
