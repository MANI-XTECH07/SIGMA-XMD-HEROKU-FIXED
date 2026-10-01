const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const settings = require('./settings');
const sessionManager = require('./lib/session-manager');

const pairingInProgress = new Set();
const recentRequests = new Map();
const PORT = Number(process.env.PORT || process.env.PAIR_PORT || 3000);
const HOST = process.env.PAIR_HOST || '0.0.0.0';
const PAGE = path.join(__dirname, 'public', 'pair.html');
const API_KEY = process.env.BOT_API_KEY || process.env.PAIR_API_KEY || '';
const BUILD_ID = process.env.BUILD_ID || 'multi-session-2026-10-01';

function cleanNumber(value) { return String(value || '').replace(/\D/g, ''); }
function validNumber(number) { return number.length >= 7 && number.length <= 15 && !number.startsWith('0'); }
function rateLimited(ip, number) {
  const key = `${ip}:${number}`;
  const now = Date.now();
  const last = recentRequests.get(key) || 0;
  if (now - last < 30_000) return true;
  recentRequests.set(key, now);
  return false;
}
function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}
function sessionSummary(sessionId, sock) {
  return {
    id: sessionId,
    number: sock?.user?.id?.split(':')[0]?.split('@')[0] || sessionId,
    connected: !!sock?.user,
    registered: !!sock?.authState?.creds?.registered,
    pairingAvailable: !sock?.authState?.creds?.registered,
  };
}
function allSessions() {
  return sessionManager.list().map(({ sessionId, socket }) => sessionSummary(sessionId, socket));
}

function startPairServer(startSession) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const ip = req.socket.remoteAddress || 'unknown';
      if (API_KEY && req.headers['x-api-key'] !== API_KEY) return sendJson(res, 401, { ok: false, error: 'Unauthorized.' });
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
        return res.end();
      }
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/pair.html')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(fs.readFileSync(PAGE));
      }
      if (req.method === 'GET' && url.pathname === '/healthz') {
        return sendJson(res, 200, {
          ok: true,
          service: 'sakuna-xmd-bot',
          build: BUILD_ID,
          multiNumber: true,
          sessions: sessionManager.list().length,
        });
      }
      if (req.method === 'GET' && (url.pathname === '/api/status' || url.pathname === '/session/status')) {
        const sessions = allSessions();
        return sendJson(res, 200, { ok: true, bot: settings.botName || 'SIGMA XMD', build: BUILD_ID, multiNumber: true, sessions, connected: sessions.some(s => s.connected), registered: sessions.some(s => s.registered), pairingAvailable: true });
      }
      if (req.method === 'POST' && (url.pathname === '/api/pair' || url.pathname === '/session/create')) {
        let payload = {};
        let raw = '';
        for await (const chunk of req) raw += chunk;
        try { payload = JSON.parse(raw || '{}'); } catch { return sendJson(res, 400, { ok: false, error: 'Invalid JSON request.' }); }
        const number = cleanNumber(payload.number || payload.phoneNumber);
        if (!validNumber(number)) return sendJson(res, 400, { ok: false, error: 'Enter a full WhatsApp number with country code, without + or spaces.' });
        if (rateLimited(ip, number)) return sendJson(res, 429, { ok: false, error: 'Please wait 30 seconds before requesting another code for this number.' });
        if (pairingInProgress.has(number)) return sendJson(res, 429, { ok: false, error: 'A pairing request for this number is already being processed. Please wait.' });
        pairingInProgress.add(number);
        try {
          let sock = sessionManager.get(number);
          if (!sock) sock = await sessionManager.start(number, startSession);
          if (!sock) return sendJson(res, 503, { ok: false, error: 'The WhatsApp session is still starting. Try again in a few seconds.' });
          if (sock.authState?.creds?.registered) return sendJson(res, 409, { ok: false, error: 'This number is already paired. Use a different number or reset this number session.' });
          const exists = await sock.onWhatsApp(`${number}@s.whatsapp.net`);
          if (!exists?.[0]?.exists) return sendJson(res, 404, { ok: false, error: 'That number is not registered on WhatsApp.' });
          const code = await sock.requestPairingCode(number);
          const formatted = String(code || '').match(/.{1,4}/g)?.join('-') || String(code || '');
          return sendJson(res, 200, { ok: true, code: formatted, number, sessionId: number, message: 'Enter this code in WhatsApp → Linked Devices → Link a Device → Link with phone number instead.' });
        } catch (error) {
          console.error(`[PAIR API ${number}]`, error);
          return sendJson(res, 500, { ok: false, error: 'WhatsApp could not generate a pairing code. Check the bot logs and try again.' });
        } finally { pairingInProgress.delete(number); }
      }
      if (req.method === 'DELETE' && url.pathname === '/session/logout') {
        let payload = {};
        let raw = '';
        for await (const chunk of req) raw += chunk;
        try { payload = JSON.parse(raw || '{}'); } catch {}
        const sessionId = cleanNumber(payload.sessionId || payload.number || url.searchParams.get('sessionId') || url.searchParams.get('number'));
        if (!validNumber(sessionId)) return sendJson(res, 400, { ok: false, error: 'Provide a valid sessionId or phone number.' });
        const sock = sessionManager.get(sessionId);
        if (!sock) return sendJson(res, 404, { ok: false, error: 'Session not found.' });
        try { await sock.logout(); sessionManager.remove(sessionId); return sendJson(res, 200, { ok: true, sessionId, message: 'Session logged out and removed.' }); }
        catch (error) { console.error(`[LOGOUT API ${sessionId}]`, error); return sendJson(res, 500, { ok: false, error: 'Could not log out this session.' }); }
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    } catch (error) {
      console.error('[PAIR SERVER]', error);
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'Internal server error.' }); else res.end();
    }
  });
  server.listen(PORT, HOST, () => console.log(`🌐 SIGMA XMD Multi-number Pair Website listening on ${HOST}:${PORT}`));
  return server;
}

module.exports = {
  startPairServer,
  setSocket(socket, sessionId) { sessionManager.set(sessionId, socket); },
  removeSocket(sessionId) { sessionManager.remove(sessionId); },
  getSocket(sessionId) { return sessionManager.get(sessionId); },
  getSockets() { return sessionManager.list(); },
};
