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

## Multi-device session

The web panel uses the live Baileys socket from `index.js`. It does not use the old external Render pairing API. The bot uses Baileys `useMultiFileAuthState`, which is WhatsApp's linked-device/multi-device authentication flow.

On WhatsApp, open **Linked devices → Link a device → Link with phone number instead**, then enter the code shown by the website. The resulting credential set is stored under `SESSION_DIR` (default: `./session`). Set `SESSION_DIR` to a persistent mounted volume when deploying to a platform with an ephemeral filesystem.

A single session directory belongs to one WhatsApp account and can represent one linked bot device. To pair a different account, log out/reset the existing session first.

Do not expose the pairing endpoint publicly without rate limiting or another access-control layer if you expect heavy traffic.
