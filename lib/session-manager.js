const sessions = new Map();
const starting = new Map();

function normalizeSessionId(value) {
  if (String(value) === 'default') return 'default';
  const id = String(value || '').replace(/\D/g, '');
  if (id.length < 7 || id.length > 15) throw new Error('INVALID_SESSION_ID');
  return id;
}

async function start(sessionId, factory) {
  const id = normalizeSessionId(sessionId);
  const existing = sessions.get(id);
  if (existing) return existing;
  if (starting.has(id)) return starting.get(id);

  const promise = Promise.resolve().then(() => factory(id)).then((socket) => {
    if (!socket) throw new Error('SESSION_START_FAILED');
    sessions.set(id, socket);
    starting.delete(id);
    return socket;
  }).catch((error) => {
    starting.delete(id);
    throw error;
  });

  starting.set(id, promise);
  return promise;
}

function set(sessionId, socket) {
  sessions.set(normalizeSessionId(sessionId), socket);
  return socket;
}

function get(sessionId) {
  try { return sessions.get(normalizeSessionId(sessionId)) || null; } catch { return null; }
}

function remove(sessionId) {
  try { return sessions.delete(normalizeSessionId(sessionId)); } catch { return false; }
}

function list() {
  return [...sessions.entries()].map(([sessionId, socket]) => ({ sessionId, socket }));
}

async function stop(sessionId, { logout = false } = {}) {
  const id = normalizeSessionId(sessionId);
  const socket = sessions.get(id);
  if (!socket) return false;
  if (logout) {
    await socket.logout();
  } else if (typeof socket.ws?.close === 'function') {
    socket.ws.close();
  }
  sessions.delete(id);
  return true;
}

module.exports = { normalizeSessionId, start, set, get, remove, list, stop };
