# SIGMA XMD Pair Website

## Start

```bash
npm install
npm start
```

The pairing page is served by the same Node process:

`http://YOUR_SERVER_IP:3000/`

Set another port with:

```bash
PAIR_PORT=8080 npm start
```

## Multi-number and multi-device sessions

The web panel uses the live Baileys socket from `index.js`. It does not use the old external Render pairing API. Each requested phone number receives an isolated Baileys socket and auth directory, while each socket uses WhatsApp's linked-device/multi-device authentication flow.

On each phone, open **Linked devices → Link a device → Link with phone number instead**, then enter that number's code. With `DATABASE_URL`, credentials are stored in PostgreSQL. Without it, the local fallback stores them under `SESSION_DIR/<number>` (default root: `./session`). Existing legacy credentials at `./session` are still supported as the `default` session.

Each number has its own session directory, so different country numbers can be paired independently. Do not share or commit any session directory; it contains private WhatsApp credentials.

## Durable cloud storage

For Render, Heroku, or any restart-prone host, set `DATABASE_URL` to a managed PostgreSQL database. When `DATABASE_URL` is present, the bot stores Baileys credentials and signal keys in PostgreSQL instead of local files and restores every saved session after restart. Never run multiple bot replicas against the same session IDs unless you add distributed locking; use one worker replica for the session process.

The session API is:

```text
POST   /session/create   { "phoneNumber": "9779800000000" }
GET    /session/status
DELETE /session/logout   { "sessionId": "9779800000000" }
```

`/api/pair` and `/api/status` remain available as compatibility aliases for the website.

Do not expose the pairing endpoint publicly without rate limiting or another access-control layer if you expect heavy traffic.
