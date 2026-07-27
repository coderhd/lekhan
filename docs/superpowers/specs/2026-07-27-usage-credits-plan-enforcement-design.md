# Usage & Credits, Real DB Credit Tracking, & Plan Restrictions Design Spec

**Date:** 2026-07-27  
**Status:** Approved  
**Goal:** Implement a dedicated Usage section in Settings with real DB-backed credit tracking, low credit warning (≤10%), depleted credit handling with BYOK fallback, official Sarvam AI credit consumption table, and plan-based document & collaborator enforcement.

---

## 1. Key Objectives & Features

1. **Dedicated Settings "Usage" Tab (`components/settings-client.tsx`)**:
   - 4 Tabs in Settings: `Profile & Security` | `Collaborators & Access` | `Usage & Credits` | `Billing & Subscription`.
   - Real DB-backed Credit Progress Card (Allocated, Consumed, Remaining).
   - **Low Credit Warning Banner (≤ 10% remaining)**:
     - Displays when remaining credits ≤ 10% of monthly plan quota (e.g. ≤ 5 credits on Free 50-credit plan).
     - Prompts user to connect a BYOK Sarvam key or upgrade plan.
   - **Depleted Credits Handling**:
     - If credits = 0 and no BYOK key is connected: AI requests trigger alert to upgrade or connect BYOK key.
     - If BYOK key is connected: Seamlessly uses user's BYOK Sarvam key without blocking.
   - **Sarvam AI Credit Cost Reference Table**:
     - Official rates derived from Sarvam API pricing:
       - Sarvam Chat: 1 Credit / request
       - Text to Speech (Bulbul): 1 Credit / 1K characters
       - Translate & Transliterate: 1 Credit / 10K characters
       - Speech to Text (ASR): 5 Credits / minute
       - Sarvam Vision (OCR): 2 Credits / page

2. **DB-Backed User Credits & Real State Sync (`services/db.ts`)**:
   - `fetchUserAICredits(userId)`: Returns `{ totalAllocated: 50, usedCredits: 15, remainingCredits: 35, plan: 'free' }`.
   - `deductUserAICredits(userId, amount)`: Deducts credits and updates DB record.
   - Real credit count displayed consistently across:
     - Profile Dropdown (`components/profile-menu.tsx`)
     - Lekhan Bot Bar (`components/lekhan-bot-bar.tsx` - hidden on mobile `< sm`)
     - AI Settings Panel (`components/ai-settings-panel.tsx`)
     - Settings Usage Tab (`components/settings-client.tsx`)

3. **Plan Differentiators & Retention Enforcement**:
   - **Document Creation Limit**:
     - Free: 5 Documents max. Blocks new document creation if limit reached.
   - **Collaborator Limit per Document**:
     - Free: 2 Collaborators max / document
     - Go: 10 Collaborators max / document
     - Pro: 25 Collaborators max / document
     - Team: 50 Collaborators max / document
   - **Plan-Based Version History Retention & Dynamic Reassurance**:
     - Retention windows: Free (7 days), Go (14 days), Pro (90 days), Team (365 days), Enterprise (Unlimited).
     - Local browser IndexedDB history and Cloud sync cleanup align with active plan retention period.
     - Dynamic reassurance note in `components/version-history.tsx` based on user's active plan:
       - Free: `"🔒 7-day cloud & local version history included in Free plan."`
       - Go: `"🔒 14-day cloud & local version history included in Go plan."`
       - Pro: `"🔒 90-day cloud & local version history included in Pro plan."`
       - Team: `"🔒 1-year cloud & local version history included in Team plan."`
   - **Pricing Matrix Updates (`components/pricing-plans.tsx` & `components/landing-page.tsx`)**:
     - On Landing Page, Free plan CTA displays **"Get started"** instead of "Current Plan".
     - Feature lists include explicit collaborator limits and are aligned with horizontal dividers.

---

## 2. Architecture & Database

### DB Schema / Helper Functions (`services/db.ts`)
```ts
export interface UserAICredits {
	plan: 'free' | 'go' | 'pro' | 'team' | 'enterprise'
	totalAllocated: number
	usedCredits: number
	remainingCredits: number
}
```

### Component Flow
1. **`ProfileMenu`**: Displays remaining credits pill (`85 Credits`) in dropdown header.
2. **`LekhanBotBar`**: Checks remaining credits / BYOK key before calling AI. Hides credit badge on mobile screen breakpoints (`hidden sm:inline-flex`).
3. **`PricingMatrix`**: Accepts `isLandingPage?: boolean` prop. When `true`, displays `"Get started"` for Free card.

---

## 3. Verification Plan
- Unit tests (`tests/unit/credits-usage.test.ts`, `tests/unit/plan-enforcement.test.ts`).
- Full Vitest suite & Next.js production build (`npm run build`).
