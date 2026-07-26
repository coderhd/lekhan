# Anthropic-Style Pricing Matrix, AES-256 BYOK Encryption, & Sarvam AI Integration Design Spec

**Date:** 2026-07-26  
**Status:** Approved  
**Goal:** Redesign the Lekhan Pricing Matrix into an Anthropic-inspired 2-category layout (Individual vs. Team & Enterprise) with cumulative feature build-ups, implement AES-256-GCM encryption for client-side BYOK storage, and restrict all AI operations exclusively to Sarvam AI.

---

## 1. Overview & Key Objectives

1. **Anthropic-Style Pricing Matrix (`components/pricing-plans.tsx`)**:
   - Top category toggle: **Individual** vs. **Team and Enterprise**.
   - **Individual Plans**:
     - **Free**: ₹0 / mo.
     - **Go**: ₹99 / mo (Yearly: ₹83 / mo, billed annually at ₹999/yr · 2 months free).
     - **Pro**: ₹499 / mo (Yearly: ₹417 / mo, billed annually at ₹4,999/yr · 2 months free).
   - **Team & Enterprise Plans**:
     - **Team**: ₹499 / seat / mo (Yearly: ₹417 / seat / mo, billed annually at ₹4,999/seat/yr). User badge: `2-150 users`.
     - **Enterprise**: Custom / pooled usage. User badge: `20+ users`.
   - **Cumulative Features**: Each tier explicitly lists cumulative capabilities using headers ("Everything in Free, plus:", "Everything in Go, plus:", "Everything in Pro, plus:", "All Team features, plus:").
   - **Billing Toggle**: `Monthly | Yearly · 2 months free`.

2. **AES-256 BYOK Encryption (`lib/crypto.ts` & `components/byok-settings.tsx`)**:
   - Use browser native Web Crypto API (`crypto.subtle` with `AES-GCM` 256-bit key derivation) to encrypt the user's API key before saving to `localStorage`.
   - Security Callouts in Settings:
     - 🔒 **AES-256-GCM Encrypted at Rest & In Memory**
     - 🛡️ **Zero-Knowledge Local Storage** — Never transmitted to Lekhan backend servers.
     - ⚡ **Direct Sarvam AI API Integration** — Used strictly for client/edge calls to Sarvam.

3. **Exclusive Sarvam AI Integration**:
   - Only accept **Sarvam API Key** (`sarvam_...`).
   - Remove all references to Gemini or any other AI providers across UI text, components, and documentation.

---

## 2. Architecture & Components

### A. Web Crypto Module (`lib/crypto.ts`)
- `encryptApiKey(plainKey: string): Promise<string>`
  - Generates a 256-bit AES-GCM key derived from client fingerprint/PBKDF2 or static salt.
  - Encrypts text and returns a base64 string combining IV + ciphertext.
- `decryptApiKey(cipherText: string): Promise<string>`
  - Decrypts base64 IV + ciphertext string using the derived key.
- `saveEncryptedApiKey(plainKey: string): Promise<void>`
  - Encrypts and writes to `localStorage.setItem('lekhan_sarvam_api_key', encrypted)`
- `getDecryptedApiKey(): Promise<string>`
  - Reads from `localStorage` and decrypts. Falls back to unencrypted legacy key if migrating, then re-encrypts.
- `clearApiKey(): void`
  - Removes `lekhan_sarvam_api_key` and legacy key from `localStorage`.

### B. Anthropic-Style Pricing Matrix (`components/pricing-plans.tsx`)
- Props: `{ currentPlan?: string }`
- Internal state:
  - `category`: `'individual' | 'team'`
  - `isYearly`: `boolean` (defaults to `true` with "Yearly · 2 months free" highlighted)
- UI Layout:
  - Top Pill Switcher: `Individual` | `Team and Enterprise`
  - Individual Grid (3 columns):
    - **Free**: Base collaborative note-taking features.
    - **Go**: Includes toggle badge, `"₹83 USD/mo billed annually (₹999/yr)"` or `"₹99/mo"`. Feature header: `"Everything in Free, plus:"`.
    - **Pro**: Includes toggle badge, `"₹417 USD/mo billed annually (₹4,999/yr)"` or `"₹499/mo"`. Feature header: `"Everything in Go, plus:"`.
  - Team & Enterprise Grid (2 columns):
    - **Team**: Badge `2-150 users`. Price `"₹417 / seat / mo billed annually"` or `"₹499 / seat / mo"`. Feature header: `"Everything in Pro, plus:"`.
    - **Enterprise**: Badge `20+ users`. Price `"Custom"`. Feature header: `"All Team features, plus:"`.

### C. Refactored BYOK Settings (`components/byok-settings.tsx`)
- Input validation for Sarvam key (`sarvam_...`).
- Visual security indicators:
  - Encryption Status Badge (`AES-256 Encrypted`).
  - Explanatory tooltip/card explaining zero-knowledge client storage.
- Save & Remove actions utilizing `lib/crypto.ts`.

### D. System-Wide Sarvam References Update
- Update `components/ai-settings-panel.tsx`, `components/settings-client.tsx`, `app/page.tsx`, and `lib/ai-constants.ts` to refer strictly to **Sarvam AI** and remove all mentions of Gemini.

---

## 3. Verification Plan

### Automated Tests (`vitest`)
1. `tests/unit/crypto.test.ts`:
   - Verify AES-256 encryption and decryption round-trip.
   - Verify invalid ciphertext handling.
2. `tests/unit/pricing-plans.test.tsx`:
   - Verify switching categories (`Individual` vs `Team and Enterprise`).
   - Verify yearly billing rate calculations (₹83/mo for Go, ₹417/mo for Pro).
   - Verify cumulative headers ("Everything in Free, plus:", "Everything in Go, plus:").
3. `tests/unit/byok-settings.test.tsx`:
   - Verify saving and loading encrypted Sarvam API key.
   - Verify AES-256 security badges render correctly.
4. Full Vitest test suite (`npm run test`) & Next.js production build (`npm run build`).

---
