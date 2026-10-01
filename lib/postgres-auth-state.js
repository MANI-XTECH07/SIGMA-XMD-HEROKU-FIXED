const { initAuthCreds, BufferJSON } = require('@whiskeysockets/baileys');

let pool;
let initialized;
let Pool;

function loadPg() {
  if (!Pool) {
    try {
      ({ Pool } = require('pg'));
    } catch {
      throw new Error('The "pg" package is required for database sessions. Run: npm install pg');
    }
  }
  return Pool;
}

function getPool() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for PostgreSQL auth state');
  if (!pool) {
    pool = new (loadPg())({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
      max: Number(process.env.DATABASE_POOL_SIZE || 5),
      idleTimeoutMillis: 30000,
    });
  }
  return pool;
}

async function ensureSchema() {
  if (!initialized) {
    initialized = (async () => {
      const db = getPool();
      await db.query(`
        CREATE TABLE IF NOT EXISTS whatsapp_sessions (
          session_id TEXT PRIMARY KEY,
          phone_number TEXT,
          creds TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'starting',
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS whatsapp_session_keys (
          session_id TEXT NOT NULL,
          key_type TEXT NOT NULL,
          key_id TEXT NOT NULL,
          value TEXT,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (session_id, key_type, key_id)
        );
        CREATE INDEX IF NOT EXISTS whatsapp_sessions_phone_idx ON whatsapp_sessions(phone_number);
      `);
    })().catch((error) => { initialized = null; throw error; });
  }
  return initialized;
}

function encode(value) {
  return JSON.stringify(value, BufferJSON.replacer);
}
function decode(value) {
  return value == null ? value : JSON.parse(value, BufferJSON.reviver);
}

async function usePostgresAuthState(sessionId, phoneNumber = sessionId) {
  await ensureSchema();
  const db = getPool();
  const row = await db.query('SELECT creds FROM whatsapp_sessions WHERE session_id = $1', [sessionId]);
  const creds = row.rows[0]?.creds ? decode(row.rows[0].creds) : initAuthCreds();

  async function saveCreds(update) {
    // Baileys passes the changed credential fields to this callback. The
    // shared creds object is already mutated, so only its current value is
    // persisted; the update payload itself is not a status string.
    const status = creds.registered ? 'registered' : 'pending';
    await db.query(`
      INSERT INTO whatsapp_sessions (session_id, phone_number, creds, status, updated_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (session_id) DO UPDATE SET
        phone_number = EXCLUDED.phone_number,
        creds = EXCLUDED.creds,
        status = EXCLUDED.status,
        updated_at = NOW()
    `, [sessionId, phoneNumber, encode(creds), status]);
  }

  const keys = {
    async get(type, ids) {
      if (!ids.length) return {};
      const result = await db.query(
        'SELECT key_id, value FROM whatsapp_session_keys WHERE session_id = $1 AND key_type = $2 AND key_id = ANY($3::text[])',
        [sessionId, type, ids]
      );
      const values = {};
      for (const row of result.rows) values[row.key_id] = decode(row.value);
      return values;
    },
    async set(data) {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        for (const [type, entries] of Object.entries(data)) {
          for (const [id, value] of Object.entries(entries)) {
            if (value === null || value === undefined) {
              await client.query('DELETE FROM whatsapp_session_keys WHERE session_id = $1 AND key_type = $2 AND key_id = $3', [sessionId, type, id]);
            } else {
              await client.query(`
                INSERT INTO whatsapp_session_keys (session_id, key_type, key_id, value, updated_at)
                VALUES ($1, $2, $3, $4, NOW())
                ON CONFLICT (session_id, key_type, key_id) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
              `, [sessionId, type, id, encode(value)]);
            }
          }
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
  };

  return {
    state: { creds, keys },
    saveCreds,
    async setStatus(status) {
      await db.query('UPDATE whatsapp_sessions SET status = $2, updated_at = NOW() WHERE session_id = $1', [sessionId, status]);
    }
  };
}

async function deletePostgresSession(sessionId) {
  await ensureSchema();
  const db = getPool();
  await db.query('DELETE FROM whatsapp_session_keys WHERE session_id = $1', [sessionId]);
  await db.query('DELETE FROM whatsapp_sessions WHERE session_id = $1', [sessionId]);
}

async function listPostgresSessions() {
  await ensureSchema();
  const result = await getPool().query('SELECT session_id, phone_number, status, updated_at FROM whatsapp_sessions ORDER BY updated_at DESC');
  return result.rows;
}

module.exports = { usePostgresAuthState, deletePostgresSession, listPostgresSessions, getPool };
