# OpenCode remote control (Pilot) — setup & known issues

## Stack

opencode v1.18.21 · @lesquel/opencode-pilot v1.23.1 · Tailscale · Telegram alerts

## One-time setup

1. `npx @lesquel/opencode-pilot init` from anywhere (installs into ~/.config/opencode,
   registers in BOTH opencode.json and tui.json plugin arrays)
2. `export PILOT_HOST=<tailscale-ip>` in ~/.zshrc — otherwise every banner/Telegram
   link advertises 0.0.0.0, which no browser can open (upstream bug, filed)
3. `export PILOT_TELEGRAM_TOKEN` / `PILOT_TELEGRAM_CHAT_ID` in ~/.zshrc
   (chat id discovered via getUpdates after messaging the bot once)
4. `export PILOT_PERMISSION_TIMEOUT=600000` (10-min approval window; default 5 min)
5. Tailscale on Mac + phone. Never expose the port publicly.

Phone bookmark: `http://<tailscale-ip>:4097/?token=<from-banner>`

## Known issues (Aug 24)

- **Permission asks on opencode v1.18 surface as native cards that cannot be
  resolved remotely** (upstream issue filed: lesquel/open-remote-control#95).
  Asks fall through and execute with permissive defaults.
- Token rotates on every server restart → phone bookmark must be refreshed.
- Access token is required as `?token=` query param AND dashboard keeps it
  browser-local.

## Workaround profile (project opencode.json)

While remote approval is broken upstream: destructive ops are set to `"deny"`
(not ask) so unattended runs fail safe instead of hanging or waiting on a
broken approval channel. Flip `rm -rf *` back to `"ask"` once #95 resolves.

## Rules of operation

- ONE opencode instance + ONE dashboard tab. Multiple instances split the
  permission queue ("couldn't resolve permission" = resolving against the
  wrong server).
- Mac awake for unattended work: `caffeinate -dims &`
- Telegram notifies on agent finish/blocked states; permission asks currently
  only appear in-dashboard (see known issue).
