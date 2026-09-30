const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const settings = require('./settings');

let currentSocket = null;
let pairingInProgress = false;
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

function rateLimited(ip) {
  const now = Date.now();
  const last = recentRequests.get(ip) || 0;
  if (now - last < 30_000) return true;
  recentRequests.set(ip, now);
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

function startPairServer(getSocket) {
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
        const sock = getSocket();
        return sendJson(res, 200, {
          ok: true,
          bot: settings.botName || 'SIGMA XMD',
          connected: !!sock?.user,
          registered: !!sock?.authState?.creds?.registered,
          pairingAvailable: !!sock && !sock?.authState?.creds?.registered,
        });
      }

      if (req.method === 'POST' && url.pathname === '/api/pair') {
        if (rateLimited(ip)) {
          return sendJson(res, 429, {
            ok: false,
            error: 'Please wait 30 seconds before requesting another code.',
          });
        }

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

        const sock = getSocket();
        if (!sock) {
          return sendJson(res, 503, {
            ok: false,
            error: 'WhatsApp socket is still starting. Try again in a few seconds.',
          });
        }

        if (sock.authState?.creds?.registered) {
          return sendJson(res, 409, {
            ok: false,
          error: 'This multi-device session is already connected. Log out/reset the session before pairing another number.',
          });
        }

        if (pairingInProgress) {
          return sendJson(res, 429, {
            ok: false,
            error: 'A pairing request is already being processed. Please wait.',
          });
        }

        pairingInProgress = true;
        try {
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
          console.error('[PAIR API]', error);
          return sendJson(res, 500, {
            ok: false,
            error: 'WhatsApp could not generate a pairing code. Check the bot logs and try again.',
          });
        } finally {
          pairingInProgress = false;
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
    console.log(`🌐 SIGMA XMD Pair Website listening on ${HOST}:${PORT}`);
  });

  return server;
}

module.exports = {
  startPairServer,
  setSocket(socket) {
    currentSocket = socket;
  },
  getSocket() {
    return currentSocket;
  },
};
