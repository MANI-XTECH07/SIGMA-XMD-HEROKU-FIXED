# Deploying SAKUNA XMD Multi-Session on Render

This deployment runs one Node worker with multiple Baileys sockets. Every WhatsApp number has a unique `sessionId` and its own credentials/keys in PostgreSQL.

## Updated project structure

```text
.
├── index.js                         # Bot bootstrap and per-session event wiring
├── pair-server.js                   # /session/* and /api/* HTTP endpoints
├── lib/
│   ├── session-manager.js           # Isolated socket registry/start/stop logic
│   ├── postgres-auth-state.js       # Durable Baileys creds + signal-key adapter
│   └── lightweight_store.js         # Message metadata store used by handlers
├── public/pair.html                 # Optional standalone pairing page
├── commands/                        # Existing Sakuna command handlers
├── data/                            # Existing bot data
├── package.json
├── package-lock.json
└── DEPLOY_RENDER_MULTI_SESSION.md
```

`lib/session-manager.js` owns the in-process socket registry and prevents two concurrent create requests for the same number from creating duplicate sockets. `lib/postgres-auth-state.js` owns durable credentials and signal keys; the bot never stores those secrets in Git.

## 1. Create PostgreSQL

Create a managed PostgreSQL database in Render or use another reachable PostgreSQL provider. Copy its **internal connection string** when the bot and database are in the same Render account/region.

Required database environment variable:

```text
DATABASE_URL=postgresql://...
DATABASE_SSL=true
```

The bot creates these tables automatically on first start:

- `whatsapp_sessions`
- `whatsapp_session_keys`

No session credentials are committed to Git.

## 2. Deploy the bot service

Before deploying, you can verify the storage layer locally against any PostgreSQL database:

```bash
DATABASE_URL=postgresql://user:pass@host:5432/db DATABASE_SSL=false npm run test:sessions
```

This checks schema creation, credential save/load, binary-safe signal-key round trips, per-session isolation, listing, and deletion. It never contacts WhatsApp.

Create a Render **Web Service** from `MANI-XTECH07/SIGMA-XMD-HEROKU-FIXED`.

Use:

```text
Build Command: npm install
Start Command: npm start
Branch: master
```

Set these environment variables:

```text
DATABASE_URL=<Render PostgreSQL connection string>
DATABASE_SSL=true
DATABASE_POOL_SIZE=5
PAIR_HOST=0.0.0.0
BOT_API_KEY=<long-random-secret>
```

Use one bot replica. Do not horizontally scale the session worker without a distributed lock because two workers must never control the same WhatsApp session.

## 3. Deploy the website proxy

Create a second Render Web Service from `MANI-XTECH07/sakuna-xmd-website`.

Use:

```text
Build Command: npm install
Start Command: npm start
Branch: main
```

Set:

```text
BOT_API_URL=https://<your-bot-service>.onrender.com
BOT_API_KEY=<same value as the bot service>
```

The website forwards `/api/pair` to the bot's multi-session API. Redeploy both services after changing environment variables.

## 4. Pair each number

For every WhatsApp account:

1. Open the website.
2. Enter the complete number with country code, without spaces.
3. Click **Generate Code**.
4. On that phone open **WhatsApp → Linked devices → Link a device → Link with phone number instead**.
5. Enter the displayed code.

The bot creates an isolated session such as:

```text
9779807044422
919876543210
447700900123
```

The credentials and signal keys are stored in PostgreSQL under the corresponding `session_id`.

## 5. API contract

```http
POST /session/create
Content-Type: application/json

{"phoneNumber":"9779807044422"}
```

Response:

```json
{"ok":true,"sessionId":"9779807044422","number":"9779807044422","code":"ABCD-EFGH"}
```

List sessions:

```http
GET /session/status
```

Log out one number:

```http
DELETE /session/logout
Content-Type: application/json

{"sessionId":"9779807044422"}
```

Compatibility aliases remain available: `/api/pair` and `/api/status`.

## 6. Resource and reliability notes

- Start with a small number of sessions. Each Baileys socket consumes memory, network connections, and message-processing CPU.
- Keep `DATABASE_POOL_SIZE` modest; it is not the number of WhatsApp sessions.
- Keep one Render instance for the bot worker unless distributed session locking is added.
- Avoid enabling full history sync for every session.
- Monitor memory and restart only after diagnosing a session problem.
- `uncaughtException` and `unhandledRejection` handlers log failures so one rejected promise is visible; session-level connection handlers reconnect only the affected session.
- PostgreSQL credentials and keys are sensitive. Restrict database access and rotate any exposed connection string immediately.
- WhatsApp may rate-limit or restrict accounts that create too many linked devices or use automation irresponsibly.
