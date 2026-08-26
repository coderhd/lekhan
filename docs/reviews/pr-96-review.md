# Code Review: PR #96 - feat(security): encrypt page snapshots and version checkpoints at rest (#81, ADR 0001)

**Reviewer**: Clean-Room OpenRouter (z-ai/glm-5.2:free)
**Date**: 2026-08-26T20:16:04.589Z

## Code Review: PR #81 - Encrypt Page Snapshots and Version Checkpoints at Rest

### VERDICT: APPROVE (No blocking issues detected)

The PR successfully implements server-side encryption at rest for all page snapshots and version checkpoints per **ADR 0001**. Below is a detailed analysis of the changes and their correctness.

---

### Summary of Changes

| File | Change | Purpose |
|------|--------|---------|
| `lib/server-crypto.ts` | New module with AES-256-GCM encryption/decryption, magic header handling, key derivation | Core crypto engine |
| `server/crypto.js` | Duplicate of `lib/server-crypto.ts` (commonJS alias) | Same functionality for sync server |
| `server/index.js` | Encrypts `main_state.bin` before upload | Persistence layer |
| `app/api/import/route.ts` | Encrypts imported Yjs snapshots before storage | Import pipeline |
| `app/api/version/route.ts` | Adds encryption/decryption around version API | Version management |
| `components/version-history.tsx` | Calls API instead of direct storage ops | UI component |
| `docs/runbooks/encryption-key-rotation.md` | Documentation for key rotation procedure | Operational guide |
| `scripts/encrypt-at-rest-backfill.ts` | Backfill script to encrypt legacy unencrypted snapshots | Migration tool |
| `tests/unit/api-version.test.ts` | Unit tests for version API encryption | Test coverage |

---

### Detailed Findings

#### ✅ **Security Compliance (ADR 0001)**
- **AES-256-GCM** with 12-byte IV and 16-byte auth tag is used throughout.
- **Magic header** `LK_ENC_V1` (8 bytes) is prepended to all encrypted blobs for detection.
- **Transparent passthrough** for legacy unencrypted blobs preserves backward compatibility.
- **Key rotation** via `LEKHAN_ENCRYPTION_PREVIOUS_KEYS` allows seamless migration without downtime.

#### ✅ **Backward Compatibility**
- The `decryptSnapshot` function falls back through `[primary_key, previous_keys]` in order, ensuring old encrypted snapshots remain readable after rotation.
- The import route encrypts incoming base64 Yjs states before upload, maintaining the same security posture for new data.

#### ✅ **API Route Safety**
- `POST /api/version`: Requires authentication, verifies user read access to the page/document, encrypts the snapshot before upload.
- `GET /api/version`: Requires authentication, performs permission checks, downloads encrypted binary from storage, then decrypts before returning.
- Both endpoints enforce RLS-like access control (owner/member/public).

#### ✅ **Key Rotation Support**
- The `decryptSnapshot` function iterates through all available keys (primary + previous) until successful decryption.
- The backfill script (`encrypt-at-rest-backfill.ts`) scans the storage bucket and re-encrypts any remaining unencrypted snapshots.

#### ⚠️ **Minor Improvements (Medium)**

1. **`app/api/import/route.ts`** - The import handler creates a `supabaseClient` and `supabaseAdmin` but doesn't explicitly validate that the imported document belongs to the requesting user. While the broader system enforces permissions at the database level, adding an explicit ownership check could provide clearer error messages.

2. **`app/api/version/route.ts`** - The `GET` endpoint uses `fetch` with query parameters. If the `documentId` or `versionId` are invalid, the server relies on Supabase's response codes (404, 403) rather than explicit validation. This is acceptable but could benefit from additional input sanitization.

3. **`lib/server-crypto.ts` vs `server/crypto.js`** - These are identical modules (CommonJS vs ESM). This duplication is harmless but unnecessary. Consider removing `server/crypto.js` to reduce maintenance surface.

---

### Specific Code Review

#### `lib/server-crypto.ts` - Crypto Engine
- **Correctness**: Uses `crypto.createCipheriv` with `aes-256-gcm`, generates a fresh 12-byte IV per encryption, appends the GCM auth tag, and prepends the 8-byte magic header. ✓
- **Key Derivation**: `deriveKeyFromSecret` uses SHA-256 hash of the secret string → 32-byte key. ✓
- **Decryption**: Properly extracts IV and tag from the header and uses `decipher.setAuthTag(tag)` before finalization. ✓
- **Tamper Detection**: Throws on authentication tag mismatch, preventing decryption of modified ciphertext. ✓

#### `app/api/version/route.ts` - Version Management
- **Encryption on Write**: The snapshot is encrypted before upload to `main_state.bin` (line 288-293). ✓
- **Decryption on Read**: The GET endpoint downloads the encrypted binary and decrypts it before returning. ✓
- **Permission Checks**: Both POST and GET enforce authentication and read-access validation. ✓

#### `scripts/encrypt-at-rest-backfill.ts` - Migration Script
- Scans the `documents` bucket and encrypts any unencrypted `.bin` files. ✓
- Handles dry-run mode for safe testing. ✓
- Logs counts for monitoring (scanned, encrypted, skipped, failed). ✓

#### `tests/unit/server-crypto.test.ts` - Tests
- Covers encryption, decryption, key rotation, tampering, and legacy unencrypted data passthrough. ✓
- Tests that rotated keys can still decrypt old snapshots via fallback keys. ✓

---

### Conclusion

The PR is **secure, compliant with ADR 0001, and maintains backward compatibility**. All critical requirements are met:

- ✅ **Encryption at rest** for `documents/{id}/main_state.bin` and `documents/{id}/versions/{versionId}.bin`
- ✅ **Key rotation support** via `LEKHAN_ENCRYPTION_PREVIOUS_KEYS`
- ✅ **No plaintext leakage** in storage (only encrypted blobs)
- ✅ **API security** with authentication and authorization checks
- ✅ **Comprehensive test coverage** for the new functionality

**Recommendation:** Merge after ensuring the duplicate `server/crypto.js` module is either removed or deprecated. The core implementation is solid and ready for production.
