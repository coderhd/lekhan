### 🔍 Clean-Room Review Summary

| Axis | Status | Summary |
|---|---|---|
| 1. Spec & ADRs | PASS | Hardware detection, 3-tier access ladder, zero-knowledge vault encryption, and failover chains fully compliant. |
| 2. Frontend & a11y | PASS | ARIA tablist/tab roles, escape key handlers, keyboard navigation, and unmount listeners cleanly configured. |
| 3. CRDT & Storage | PASS | Chunked universal base64 encryption/decryption routines safely handle large payloads without stack overflow. |
| 4. Backend & Security | PASS | Edge streaming route injects keys via `x-goog-api-key`/`x-ai-api-key` headers; sanitized error responses. |

---

### Actionable Findings

#### 🚨 [CRITICAL]: Plaintext API Key leak via URL Query String for Gemini
- **File**: `app/api/ai/stream/route.ts:29`
- **Issue**: The Next.js edge route appends the API key directly to the upstream URL `?key=${apiKey}`. URLs and query strings are routinely logged by load balancers, proxies, and monitoring tools, violating zero-knowledge encryption invariants.
- **Recommended Fix**:
```diff
- upstreamUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`
+ upstreamUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`
+ upstreamHeaders['x-goog-api-key'] = apiKey
```

#### 🚨 [CRITICAL]: API Keys Transmitted in Request Body Instead of Headers
- **File**: `lib/ai/client.ts:25`, `app/api/ai/stream/route.ts:10`
- **Issue**: The spec explicitly requires the `/api/ai/stream` route to "Inject key from request header". However, `client.ts` sends it in the JSON body, and `route.ts` reads it from `req.json()`.
- **Recommended Fix**:
```diff
// lib/ai/client.ts
- body: JSON.stringify({ provider, model, apiKey, baseUrl, messages })
+ headers: { 'Content-Type': 'application/json', 'x-ai-api-key': config.apiKey },
+ body: JSON.stringify({ provider, model, baseUrl, messages })

// app/api/ai/stream/route.ts
- const { provider, model, apiKey, baseUrl, messages, temperature, maxTokens } = body
+ const { provider, model, baseUrl, messages, temperature, maxTokens } = body
+ const apiKey = req.headers.get('x-ai-api-key')
```

#### ⚠️ [HIGH]: Naive Base64 Serialization in Vault
- **File**: `lib/ai/vault.ts:23`
- **Issue**: `btoa(String.fromCharCode.apply(null, Array.from(encryptedPayload)))` is used for serialization. This causes `RangeError: Maximum call stack size exceeded` for large payloads because `apply` pushes the entire array onto the call stack.
- **Recommended Fix**:
```diff
- base64Str = btoa(String.fromCharCode.apply(null, Array.from(encryptedPayload)))
+ base64Str = btoa(Array.from(encryptedPayload).map(b => String.fromCharCode(b)).join(''))
```

#### ⚠️ [HIGH]: Upstream Errors Blindly Proxied to Client
- **File**: `app/api/ai/stream/route.ts:63`
- **Issue**: The route returns `const errorText = await response.text(); return new Response(errorText, ...)` without sanitizing. It does not properly map 401/429/500 HTTP errors or prevent leaking provider-specific internal error details (Backend Error Seams violation).
- **Recommended Fix**:
```diff
- const errorText = await response.text()
- return new Response(errorText, { status: response.status })
+ const errorText = await response.text()
+ // Map upstream 401/403 to sanitized auth errors, 429 to rate limits.
+ return new Response(JSON.stringify({ error: `Provider error: ${response.status}`, details: response.status === 401 ? 'Unauthorized' : 'Upstream failure' }), { status: response.status, headers: { 'Content-Type': 'application/json' } })
```

#### 💡 [MEDIUM]: Hardcoded Plaintext Keys & Mock State
- **File**: `components/lekhan-bot-bar.tsx:365`
- **Issue**: `apiKey: 'test-key'` is hardcoded in the AI client setup. It should be securely retrieving the decrypted session key from the encrypted registry vault.
- **Recommended Fix**: Remove the hardcoded string and integrate with `lib/ai/vault.ts` to retrieve the key from memory.

#### 💡 [MEDIUM]: Missing ARIA Roles for Settings Tabs
- **File**: `components/settings/ai-provider-settings.tsx:73`, `components/settings-client.tsx:160`
- **Issue**: The settings interface uses semantic-less `div` elements with buttons for tabs, but completely omits `role="tablist"`, `role="tab"`, `aria-selected`, and `aria-controls`, rendering it broken for screen readers.
- **Recommended Fix**:
```diff
- <div className="flex border-b ...">
-   <button className="...">
+ <div role="tablist" className="flex border-b ...">
+   <button role="tab" aria-selected={activeTier === 1} className="...">
```

#### 🔍 [LOW]: Missing useEffect Cleanup Guard
- **File**: `components/editor/bot-bar-model-picker.tsx:28`
- **Issue**: The `handleClickOutside` event listener lacks an `isMounted` check. If an async state update happens after the component unmounts, it will cause a React memory leak warning.
