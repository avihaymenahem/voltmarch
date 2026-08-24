# Production relay deployment

This directory turns a fresh Debian/Ubuntu VPS into the production Voltmarch relay and
then lets GitHub Actions deploy immutable, automatically rolled-back releases.

## Architecture

`game -> Cloudflare wss://relay.voltmarch.com/ws -> nginx :443 -> relay 127.0.0.1:8787`

The relay port is never public. nginx terminates TLS, restores the player IP
only from Cloudflare's published edge ranges, and forwards the WebSocket to the
unprivileged Node service.

## One-time preparation

1. In Cloudflare DNS, create an `A` record named `relay` pointing to the VPS.
   Leave it **DNS only** for the first certificate request.
2. Copy this directory to the VPS and run `bootstrap-host.sh` as root:

   ```bash
   RELAY_HOSTNAME=relay.voltmarch.com \
   GAME_ORIGINS=https://play.voltmarch.com \
   LETSENCRYPT_EMAIL=operator@example.com \
   DEPLOY_PUBLIC_KEY='ssh-ed25519 AAAA... voltmarch-hostinger-deploy' \
   bash bootstrap-host.sh
   ```

3. Switch the Cloudflare record to **Proxied**, set SSL/TLS to **Full
   (strict)**, and ensure Network -> WebSockets is on.
4. Add a GitHub environment named `production-relay`, then configure:

   - Repository variable `RELAY_SSH_HOST` — the VPS IP.
   - Optional variable `RELAY_SSH_PORT` — defaults to `22`.
   - Secret `RELAY_SSH_PRIVATE_KEY` — the dedicated private deployment key.
   - Secret `RELAY_SSH_KNOWN_HOSTS` — the verified `ssh-keyscan` line for the VPS.

5. Run the **Deploy multiplayer relay** workflow once. It audits, tests,
   builds, uploads, activates, probes through loopback, then probes through
   Cloudflare. Any activation failure restores the previous release.

The GitHub Pages workflow serving `play.voltmarch.com` bakes
`wss://relay.voltmarch.com/ws` into the client. The game still probes the relay
before enabling Multiplayer, so a relay outage does not leave a dead lobby
button.

## Files

- `bootstrap-host.sh` — idempotent operating-system and reverse-proxy setup.
- `deploy-release.sh` — restricted atomic release installer and rollback.
- `voltmarch-relay.service` — sandboxed unprivileged Node process.
- `nginx.conf` — TLS/WebSocket proxy and connection limits. The bootstrap
  substitutes the production hostname into this canonical template.
- `smoke.mjs` — validates WebSocket, Origin, protocol and build together.

## Routine releases

Run the `Deploy multiplayer relay` workflow, then deploy the matching GitHub Pages
client. The relay updates `VM_REQUIRE_BUILD` during activation, preventing two
different deterministic builds from entering the same match.

Every relay restart ends active matches: rooms are in memory and this version
does not support reconnection. Deploy during a quiet window.
