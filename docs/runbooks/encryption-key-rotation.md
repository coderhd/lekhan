# Runbook: Server-Side Encryption Key Rotation (ADR 0001)

## 1. Overview & Threat Model

Per **ADR 0001**, all page state snapshots (`documents/{id}/main_state.bin`) and version checkpoints (`documents/{id}/versions/{versionId}.bin`) in Supabase Storage are encrypted at rest using **AES-256-GCM** with an authenticated binary header (`LK_ENC_V1`).

This protects against:
- Storage bucket public leaks or misconfigured bucket permissions.
- Database/storage provider employee snooping or infrastructure breaches.
- Backups or cold storage media compromise.

---

## 2. Environment Variables

| Variable | Description | Example |
|---|---|---|
| `LEKHAN_ENCRYPTION_KEY` | The active primary 256-bit key used for all new writes and primary decryption. | `e9b8f... (64 hex characters or 32+ char secret)` |
| `LEKHAN_ENCRYPTION_PREVIOUS_KEYS` | Comma-separated list of retired keys for zero-downtime read decryption during rotation. | `key1,key2` |

*(Note: In local development, if `LEKHAN_ENCRYPTION_KEY` is omitted, the server derives a deterministic key from `SUPABASE_SECRET_KEY` / `SUPABASE_SERVICE_ROLE_KEY`)*

---

## 3. Routine Key Rotation Procedure (Zero-Downtime)

Follow this procedure periodically (e.g. quarterly or annually) to rotate server-held keys without service interruption.

### Step 1: Generate a New Primary Key
Generate a cryptographically secure 256-bit key:
```bash
openssl rand -hex 32
# Output: 4f8d5a1b3c9e2f7a8b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a
```

### Step 2: Update Server Secrets
1. Move the current `LEKHAN_ENCRYPTION_KEY` value into `LEKHAN_ENCRYPTION_PREVIOUS_KEYS`.
2. Set `LEKHAN_ENCRYPTION_KEY` to the newly generated key.

### Step 3: Deploy Application & Sync Server
Deploy the web app and sync server with the updated environment configuration.
* All new snapshot writes and edits will immediately use the new key.
* Reads of older snapshots will seamlessly decrypt via `LEKHAN_ENCRYPTION_PREVIOUS_KEYS`.

### Step 4: Re-Encrypt Existing Snapshots
Run the backfill migration script to re-encrypt existing snapshots with the new primary key:
```bash
npx tsx scripts/encrypt-at-rest-backfill.ts
```

### Step 5: Clean Up Previous Keys
Once all snapshots in storage have been verified and rewritten with the new key, remove the retired key from `LEKHAN_ENCRYPTION_PREVIOUS_KEYS` and redeploy.

---

## 4. Emergency Key Compromise Runbook

If `LEKHAN_ENCRYPTION_KEY` is leaked or compromised:

1. **Rotate immediately**:
   - Generate a new key and update `LEKHAN_ENCRYPTION_KEY`.
   - Keep the compromised key in `LEKHAN_ENCRYPTION_PREVIOUS_KEYS` temporarily only to allow the backfill script to decrypt and re-encrypt existing data.
2. **Execute immediate backfill**:
   ```bash
   npx tsx scripts/encrypt-at-rest-backfill.ts
   ```
3. **Revoke old key**:
   - Clear `LEKHAN_ENCRYPTION_PREVIOUS_KEYS` immediately after the backfill completes.
   - Any future attempts to decrypt with the old key will fail.
4. **Audit storage access logs**:
   - Review Supabase Storage access logs for unauthorized downloads during the suspected exposure window.
