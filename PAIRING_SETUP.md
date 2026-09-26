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

## Important

The web panel uses the live Baileys socket from `index.js`. It does not use the old external Render pairing API.

A single `./session` belongs to one WhatsApp account. To pair a different account, log out/reset the existing session first.

Do not expose the pairing endpoint publicly without rate limiting or another access-control layer if you expect heavy traffic.
