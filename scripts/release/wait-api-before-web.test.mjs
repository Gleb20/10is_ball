import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rootProductVersion } from './release-lib.mjs';
import { waitForApiDrain, gateProductionWebBuild } from './wait-api-before-web.mjs';

const release = { sha: 'a'.repeat(40), version: '6.0.0', environment: 'production', dirty: false };
function harness(observe = () => ({})) {
  let time = 0;
  const calls = [];
  return {
    calls, now: () => time,
    wait: async (ms) => { assert(ms > 0 && ms <= 15_000); time += ms; },
    fetchImpl: async (input, options) => {
      const url = String(input);
      assert.equal(new URL(url).origin, 'https://one0is-ball.onrender.com');
      assert.equal(options.redirect, 'error');
      assert(options.signal);
      calls.push({ time, url });
      const { mismatch = false, notReady = false, failure = false } = observe(time, url);
      if (failure) throw new Error('network failure');
      if (url.endsWith('openapi.json')) return new Response(JSON.stringify({ info: { version: release.version } }));
      return new Response(JSON.stringify({ status: url.endsWith('/health') ? 'ok' : notReady ? 'not_ready' : 'ready', release: mismatch ? { ...release, sha: 'b'.repeat(40) } : release }));
    },
  };
}

test('requires a complete continuous drain window after exact API release is ready', async () => {
  const h = harness();
  const result = await waitForApiDrain({ expected: release, ...h });
  assert.equal(result.verifiedForMs, 420_000);
  assert.equal(h.now(), 420_000);
  assert(h.calls.length >= 29 * 3);
});
test('old SHA does not start the drain clock', async () => {
  const h = harness((time) => ({ mismatch: time < 60_000 }));
  const result = await waitForApiDrain({ expected: release, ...h });
  assert.equal(result.verifiedForMs, 420_000);
  assert.equal(h.now(), 480_000);
});
for (const reason of ['mismatch', 'notReady', 'failure']) {
  test(`a ${reason} resets the drain clock rather than accepting an interrupted window`, async () => {
    const h = harness((time) => ({ [reason]: time === 390_000 }));
    const result = await waitForApiDrain({ expected: release, ...h });
    assert.equal(result.verifiedForMs, 420_000);
    assert.equal(h.now(), 825_000);
  });
}
test('never-ready API fails closed within the fixed timeout', async () => {
  const h = harness(() => ({ mismatch: true }));
  await assert.rejects(waitForApiDrain({ expected: release, ...h }), /timed out/);
  assert.equal(h.now(), 25 * 60_000);
});
test('local and preview builds never wait on or contact production', async () => {
  for (const env of [{}, { NODE_ENV: 'production' }, { VERCEL_ENV: 'preview' }]) {
    const result = await gateProductionWebBuild({ env, waitForApi: () => { throw new Error('must not call'); } });
    assert.equal(result.status, 'not-production');
  }
});
test('production requires a full Git SHA before any network request', async () => {
  await assert.rejects(gateProductionWebBuild({ env: { VERCEL_ENV: 'production' }, waitForApi: () => { throw new Error('must not call'); } }), /VERCEL_GIT_COMMIT_SHA/);
});
test('production passes canonical root version and identical clean SHA to its gate', async () => {
  const result = await gateProductionWebBuild({
    env: { VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_SHA: release.sha },
    waitForApi: async ({ expected }) => { assert.equal(expected.sha, release.sha); assert.equal(expected.version, await rootProductVersion()); assert.equal(expected.dirty, false); return { verifiedForMs: 420_000 }; },
  });
  assert.equal(result.status, 'ready');
});
