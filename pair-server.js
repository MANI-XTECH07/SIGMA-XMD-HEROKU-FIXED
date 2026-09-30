const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const settings = require('./settings');

const sockets = new Map();
const pairingInProgress = new Set();
const recentRequests = new Map();

const PORT = Number(process.env.PORT || process.env.PAIR_PORT || 3000);
const HOST = process.env.PAIR_HOST || '0.0.0.0';
const PAGE = path.join(__dirname, 'public', 'pair.html');

function cleanNumber(value) {
  return String(value || '').replace(/\D/g, '');
}

function validNumber(number) {
  return number.length >= 7 && number.length <= 15 && !number.startsWith('0');
}

function rateLimited(ip, number) {
  const key = `${ip}:${number}`;
  const now = Date.now();
  const last = recentRequests.get(key) || 0;
  if (now - last < 30_000) return true;
  recentRequests.set(key, now);
  return false;
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

function sessionSummary(sessionId, sock) {
  return {
    id: sessionId,
    number: sock?.user?.id?.split(':')[0]?.split('@')[0] || (sessionId === 'default' ? null : sessionId),
    connected: !!sock?.user,
    registered: !!sock?.authState?.creds?.registered,
    pairingAvailable: !sock?.authState?.creds?.registered,
  };
}

function startPairServer(startSession) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const ip = req.socket.remoteAddress || 'unknown';

      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        });
        return res.end();
      }

      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/pair.html')) {
        const html = fs.readFileSync(PAGE);
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        return res.end(html);
      }

      if (req.method === 'GET' && url.pathname === '/api/status') {
        const sessions = [...sockets.entries()].map(([id, sock]) => sessionSummary(id, sock));
        return sendJson(res, 200, {
          ok: true,
          bot: settings.botName || 'SIGMA XMD',
          multiNumber: true,
          sessions,
          connected: sessions.some((session) => session.connected),
          registered: sessions.some((session) => session.registered),
          pairingAvailable: true,
        });
      }

      if (req.method === 'POST' && url.pathname === '/api/pair') {
        let raw = '';
        for await (const chunk of req) raw += chunk;

        let payload;
        try {
          payload = JSON.parse(raw || '{}');
        } catch {
          return sendJson(res, 400, { ok: false, error: 'Invalid JSON request.' });
        }

        const number = cleanNumber(payload.number);
        if (!validNumber(number)) {
          return sendJson(res, 400, {
            ok: false,
            error: 'Enter a full WhatsApp number with country code, without + or spaces.',
          });
        }

        if (rateLimited(ip, number)) {
          return sendJson(res, 429, {
            ok: false,
            error: 'Please wait 30 seconds before requesting another code for this number.',
          });
        }

        if (pairingInProgress.has(number)) {
          return sendJson(res, 429, {
            ok: false,
            error: 'A pairing request for this number is already being processed. Please wait.',
          });
        }

        pairingInProgress.add(number);
        try {
          let sock = sockets.get(number);
          if (!sock) sock = await startSession(number);
          if (!sock) {
            return sendJson(res, 503, {
              ok: false,
              error: 'The WhatsApp session is still starting. Try again in a few seconds.',
            });
          }

          if (sock.authState?.creds?.registered) {
            return sendJson(res, 409, {
              ok: false,
              error: 'This number is already paired. Use a different number or reset this number session.',
            });
          }

          const exists = await sock.onWhatsApp(`${number}@s.whatsapp.net`);
          if (!exists?.[0]?.exists) {
            return sendJson(res, 404, {
              ok: false,
              error: 'That number is not registered on WhatsApp.',
            });
          }

          const code = await sock.requestPairingCode(number);
          const formatted = String(code || '').match(/.{1,4}/g)?.join('-') || String(code || '');
          return sendJson(res, 200, {
            ok: true,
            code: formatted,
            number,
            message: 'Enter this code in WhatsApp → Linked Devices → Link a Device → Link with phone number instead.',
          });
        } catch (error) {
          console.error(`[PAIR API ${number}]`, error);
          return sendJson(res, 500, {
            ok: false,
            error: 'WhatsApp could not generate a pairing code. Check the bot logs and try again.',
          });
        } finally {
          pairingInProgress.delete(number);
        }
      }

      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    } catch (error) {
      console.error('[PAIR SERVER]', error);
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'Internal server error.' });
      else res.end();
    }
  });

  server.listen(PORT, HOST, () => {
    console.log(`🌐 SIGMA XMD Multi-number Pair Website listening on ${HOST}:${PORT}`);
  });

  return server;
}

module.exports = {
  startPairServer,
  setSocket(socket, sessionId = 'default') {
    sockets.set(sessionId, socket);
  },
  removeSocket(sessionId = 'default') {
    sockets.delete(sessionId);
  },
  getSocket(sessionId = 'default') {
    return sockets.get(sessionId) || null;
  },
  getSockets() {
    return sockets;
  },
};
