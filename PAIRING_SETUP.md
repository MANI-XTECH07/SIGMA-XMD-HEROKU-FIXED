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

On each phone, open **Linked devices → Link a device → Link with phone number instead**, then enter that number's code. The credential set is stored under `SESSION_DIR/<number>` (default root: `./session`). Existing legacy credentials at `./session` are still supported as the `default` session. Set `SESSION_DIR` to a persistent mounted volume when deploying to a platform with an ephemeral filesystem.

Each number has its own session directory, so different country numbers can be paired independently. Do not share or commit any session directory; it contains private WhatsApp credentials.

Do not expose the pairing endpoint publicly without rate limiting or another access-control layer if you expect heavy traffic.
