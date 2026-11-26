# Deploy the sync relay

Run the relay as one long-running Node 24 process with a persistent writable volume. It serves `/health`, the page WebSocket, and the checkpoint, attachment, and page-sync HTTP routes on the same port. Terminate TLS in front of the relay and forward WebSocket upgrades and the original request paths to it.

## Build and start

Run the build from the repository root.

```sh
docker build -f server/sync/Dockerfile -t lekhan-sync:release .
docker volume create lekhan-sync-wal
docker run --detach --name lekhan-sync --init --read-only --stop-timeout 60 \
  --env-file relay.env \
  --mount type=volume,source=lekhan-sync-wal,target=/var/lib/lekhan/wal \
  --publish 127.0.0.1:8080:8080 lekhan-sync:release
```

The example binds the container to a proxy on the same host. A container platform can route directly to port 8080. Set `PORT` if the platform assigns another port. The image runs as UID 1000 and uses `/var/lib/lekhan/wal` by default. Give UID 1000 write and traverse access to the mounted directory. The process checks that directory before listening, and the image checks `/health`.

Set these variables through the relay host’s secret store or an untracked `relay.env` on the host.

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | The Supabase project used by this app environment |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | The project's publishable key |
| `SUPABASE_SECRET_KEY` | The project's server-only key |
| `LEKHAN_PUBLIC_URL` | The exact origin users open for this app environment |
| `LEKHAN_SYNC_TICKET_SECRET` | The same ticket signing secret as the web app |
| `LEKHAN_ENCRYPTION_KEY` | The same snapshot encryption key as the web app |
| `LEKHAN_ENCRYPTION_PREVIOUS_KEYS` | Comma-separated decrypt-only keys during rotation or migration |

Set `LEKHAN_SYNC_URL` on the app to the relay’s `wss://` origin. Proxy `/checkpoint-transfer/`, `/attachments/`, and `/page-sync/` on the same hostname over HTTPS. Keep the app and relay on the same storage ceiling if `LEKHAN_DOCUMENTS_STORAGE_LIMIT_BYTES` is set. Configure [relay observability](observability.md) for the deployed environment.

## Verify and replace the relay

1. Apply the migrations for the target environment. Verify TLS and `/health` from outside the host.
2. Open a shared page from the hosted app. Confirm an owner and an editor receive each other’s changes, a viewer can read them, and a revoked collaborator loses access. Check checkpoint transfers and attachments over the public relay origin.
3. Exercise restart and storage recovery in staging with the same volume. Confirm an accepted edit survives a relay restart while snapshot storage is unavailable and reaches Storage once it is available again.
4. Stop the old relay with `SIGTERM` and allow time for outstanding snapshots before replacing it. Attach the same WAL volume to the replacement. A failed flush leaves pending edits on the volume for replay. Bring up only one writer per volume.

The relay can run retention and import receipt cleanup with `LEKHAN_PRUNE_CHECKPOINTS=1` and `LEKHAN_PRUNE_IMPORT_RECEIPTS=1` after the corresponding migrations. Enable `LEKHAN_DRAIN_WAITLIST=1` after configuring Brevo for that environment.
