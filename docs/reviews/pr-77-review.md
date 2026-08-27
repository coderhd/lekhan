### 🔍 Clean-Room Review Summary

| Axis | Status | Summary |
|---|---|---|
| 1. Spec & ADRs | PASS | Ledger table migration and tier limit overrides implemented according to spec requirements. |
| 2. Frontend & a11y | PASS | No UI files modified (N/A). |
| 3. CRDT & Storage | PASS | 2-second idle debounce and 10-second max throttle are implemented correctly. 10MB payload size ceiling is enforced on incoming frames. |
| 4. Backend & Security | PASS | **RESOLVED**: `server/ledger.js` now throws database errors rather than returning permissive fallbacks; unit tests updated to verify error propagation. |

---

### Actionable Findings

#### 🚨 [CRITICAL]: Ledger Swallows Database Errors Bypassing Tier Limits
- **File**: `server/ledger.js:13-21` & `34-42`
- **Issue**: `getDistinctCollaboratorsCount` and `isCollaboratorRegistered` catch database errors and return permissive fallback values (`0` and `false`). If Postgres is under load or down, `currentCount` evaluates to 0, which bypasses the `if (!isRegistered && currentCount >= limits.maxDistinctCollaborators)` check. This allows unbounded access regardless of plan limits.
- **Recommended Fix**: Propagate errors so that the upstream `server/index.js` upgrade handler's `try/catch` block correctly rejects the WebSocket handshake with a 500 Internal Server Error.

```diff
-		if (error) {
-			console.error(`[Ledger] Error fetching distinct collaborators for ${documentId}:`, error)
-			return 0
-		}
+		if (error) throw error
 
 		return (data && Array.isArray(data)) ? data.length : 0
 	} catch (err) {
-		console.error(`[Ledger] Unexpected error in getDistinctCollaboratorsCount for ${documentId}:`, err)
-		return 0
+		console.error(`[Ledger] Error in getDistinctCollaboratorsCount for ${documentId}:`, err)
+		throw err
 	}
```
*(Apply the same fix to `isCollaboratorRegistered`)*

#### ⚠️ [HIGH]: Unit Tests Enforce Unsafe Permissive Fallbacks
- **File**: `tests/unit/sync-server-ledger.test.ts:25-36`
- **Issue**: The test explicitly verifies the unsafe error swallowing behavior. It needs to be rewritten to assert that the error is propagated.
- **Recommended Fix**:

```diff
-	it('handles database errors gracefully and returns fallback', async () => {
+	it('propagates database errors instead of returning permissive fallbacks', async () => {
 		mockSupabase.from.mockReturnValue({
 			select: vi.fn().mockReturnValue({
 				eq: vi.fn().mockResolvedValue({
 					data: null,
 					error: new Error('Postgres connection failed'),
 				}),
 			}),
 		})
 
-		const count = await getDistinctCollaboratorsCount(mockSupabase, 'doc-123')
-		expect(count).toBe(0)
+		await expect(getDistinctCollaboratorsCount(mockSupabase, 'doc-123'))
+			.rejects.toThrow('Postgres connection failed')
 	})
```
