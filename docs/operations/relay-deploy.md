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

The **Sync relay image** workflow builds the Linux amd64 image, verifies startup and volume persistence, then uploads it as `lekhan-relay-linux-amd64`. Use the artifact for the matching release revision. Download and unpack the artifact directory with `gh run download <run-id> -n lekhan-relay-linux-amd64`. Load `lekhan-relay.tar.gz` with `docker load -i lekhan-relay.tar.gz` and use the reported image tag in the run command.

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

## Render staging

Create the `lekhan-sync-staging` Blueprint from `coderhd/lekhan` on `integration/h0-rebuild` using the path `server/sync/render-staging.yaml`. The Blueprint creates a separate free service. The existing Lekhan service in Render's Production environment serves the earlier deployment.

Use the same approved HTTPS preview origin for `LEKHAN_PUBLIC_URL` on the relay and in the integration branch's Vercel Preview settings. The branch alias [responds to the app health check](https://lekhan-staging-git-integra-e71f33-harshdave1995-admins-projects.vercel.app/api/health) and stays stable across builds. Add that exact host's Auth callback paths to the staging Supabase redirect allowlist before using it for signup and recovery. Set the same staging ticket secret and encryption key on both services. Once the relay reports healthy, set `LEKHAN_SYNC_URL` to its `wss://` origin in the same branch-specific Preview settings and redeploy the app.

The free service loses its WAL at restart, redeploy, or idle shutdown. Use throwaway staging pages for HTTP and WebSocket tests. For the production durability drill, attach a persistent disk at `/var/lib/lekhan/wal` on a plan that supports it. [Render free service limits](https://render.com/docs/free) · [Render persistent disks](https://render.com/docs/disks)

## Verify and replace the relay

1. Apply the migrations for the target environment. Verify TLS and `/health` from outside the host.
2. Open a shared page from the hosted app. Confirm an owner and an editor receive each other’s changes, a viewer can read them, and a revoked collaborator loses access. Check checkpoint transfers and attachments over the public relay origin.
3. Exercise restart and storage recovery in staging with the same volume. Confirm an accepted edit survives a relay restart while snapshot storage is unavailable and reaches Storage once it is available again.
4. Stop the old relay with `SIGTERM` and allow time for outstanding snapshots before replacing it. Attach the same WAL volume to the replacement. A failed flush leaves pending edits on the volume for replay. Bring up only one writer per volume.

Find applied repository migrations in `supabase_migrations.schema_migrations` by their `repo_<version>_<name>` entry. The Supabase MCP recorded a separate apply timestamp in the ledger's `version` column. Staging has all 24 rebuild entries. Production has the legacy admission prerequisite, page invitations, and cloud import entries. The remaining 21 are part of the coordinated cutover.

The staging database passed the page access check for owners, editors, viewers, unrelated signed-in users, and guests. The owner's title update succeeded and the viewer's update was denied. The shared page became unreadable to the viewer as soon as the owner revoked access. All fixtures were rolled back. Step 2 verifies live edits and transfers through the hosted relay.

Staging grants block direct membership and invitation inserts by clients. Signed-in clients have column-level update access to the membership role, subject to the owner policy. The checked outbox, import, attachment, and cutover tables expose no read or write columns to clients. The service role can write the outbox and import records and read attachment metadata. Attachment and cutover writes use their database functions.

The read-only production census opened 67 main snapshots and both stored checkpoints. The previous relay's documented Supabase service-key fallback opened all 36 encrypted main snapshots. The other 31 main snapshots and both checkpoints were raw Yjs updates. Preserve that exact historical key in the decrypt-only rotation list when configuring the new primary key. A Node 24 rehearsal recovered prior-key WAL records after SIGKILL, flushed a snapshot encrypted with the new key, and reopened it with the new key alone. Repeat the drill on the hosted volume before cutover.

The legacy cutover command was rehearsed on the production migration history with six synthetic documents, five existing mappings, and two checkpoints. The dry run left the records untouched. Applying the three batches preserved the legacy document ID, checkpoint IDs and timestamps, and Storage paths. A second apply made no changes. Run the real dry run again after the old relay stops because the rehearsal used disposable data.

A read-only production census found six legacy documents. Five have same-ID page mappings with the same owner, and one needs a page. Two checkpoints still point to legacy documents. The one pending legacy invitation already has a page invitation with the same token, recipient, role, and status. The census found no mapping conflicts or unsupported member roles. The staging dry run reported zero legacy documents, so it confirmed that the function is deployed and cannot stand in for the production dry run.

The relay can run retention and import receipt cleanup with `LEKHAN_PRUNE_CHECKPOINTS=1` and `LEKHAN_PRUNE_IMPORT_RECEIPTS=1` after the corresponding migrations. Enable `LEKHAN_DRAIN_WAITLIST=1` after configuring Brevo for that environment.
