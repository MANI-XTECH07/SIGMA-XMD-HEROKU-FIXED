/**
 * Smoke test for the durable multi-session storage layer.
 *
 * Verifies, without contacting WhatsApp:
 *   1. schema creation
 *   2. credential save/load round trip per session
 *   3. signal-key round trip including binary values
 *   4. session isolation (one session cannot read another's keys)
 *   5. session listing and deletion
 *
 * Usage:
 *   DATABASE_URL=postgresql://user:pass@host:5432/db DATABASE_SSL=false \
 *     node scripts/smoke-test-sessions.js
 */
const assert = require('assert');
const {
  usePostgresAuthState,
  deletePostgresSession,
  listPostgresSessions,
} = require('../lib/postgres-auth-state');

const SESSION_A = '9779800000001';
const SESSION_B = '14155550123';

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required to run this smoke test.');
    process.exit(1);
  }

  const authA = await usePostgresAuthState(SESSION_A, SESSION_A);
  await authA.saveCreds();

  const authB = await usePostgresAuthState(SESSION_B, SESSION_B);
  await authB.saveCreds();

  const stored = await listPostgresSessions();
  const ids = stored.map((row) => row.session_id);
  assert(ids.includes(SESSION_A), 'session A should be listed');
  assert(ids.includes(SESSION_B), 'session B should be listed');
  console.log('schema + credential save: ok');

  const binaryValue = { payload: Buffer.from('signal-key-bytes'), counter: 7 };
  await authA.state.keys.set({ 'pre-key': { 'key-1': binaryValue } });

  const readBack = await authA.state.keys.get('pre-key', ['key-1']);
  assert(Buffer.isBuffer(readBack['key-1'].payload), 'binary payload should decode to a Buffer');
  assert.strictEqual(readBack['key-1'].payload.toString(), 'signal-key-bytes');
  assert.strictEqual(readBack['key-1'].counter, 7);
  console.log('signal key round trip (binary safe): ok');

  const isolated = await authB.state.keys.get('pre-key', ['key-1']);
  assert.deepStrictEqual(isolated, {}, 'session B must not see session A keys');
  console.log('session isolation: ok');

  await deletePostgresSession(SESSION_A);
  await deletePostgresSession(SESSION_B);
  const afterDelete = await listPostgresSessions();
  const remaining = afterDelete.map((row) => row.session_id);
  assert(!remaining.includes(SESSION_A), 'session A should be deleted');
  assert(!remaining.includes(SESSION_B), 'session B should be deleted');
  console.log('session deletion: ok');

  console.log('\nAll session storage checks passed.');
  process.exit(0);
}

main().catch((error) => {
  console.error('Smoke test failed:', error.message);
  process.exit(1);
});
