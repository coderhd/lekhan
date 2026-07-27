# Usage & Credits, Real DB Credit Tracking, & Plan Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a dedicated Usage tab in Settings featuring real DB-backed credit tracking, low credit warning banner (≤10%), depleted credit handling with BYOK fallback, official Sarvam AI credit cost reference table, profile menu credit display, mobile bot bar responsiveness, and plan-based document, collaborator & retention enforcement.

**Architecture:**
- `services/db.ts`: Handles user credit tracking (`getUserAICredits`, `deductUserAICredits`), document limit checks, and collaborator plan limit enforcement.
- `components/pricing-plans.tsx`: Accepts `isLandingPage` prop to render `"Get started"` for Free plan on landing page, lists explicit collaborator limits per tier, and aligns feature sections.
- `components/profile-menu.tsx`: Displays remaining credits pill (`85 Left`) in profile dropdown header.
- `components/lekhan-bot-bar.tsx`: Hides credits badge on mobile screens (`hidden sm:inline-flex`) to prevent action button overflow.
- `components/settings-client.tsx`: Adds dedicated **Usage & Credits** tab containing credit consumption progress, low credit warning banner, depleted credit notice, and Sarvam AI credit reference table.
- `components/version-history.tsx`: Displays dynamic retention reassurance note based on active plan tier (7d for Free, 14d for Go, 90d for Pro, 1y for Team).

**Tech Stack:** Next.js, React 19, Supabase DB, Vitest, Tailwind CSS.

## Global Constraints
- String single quotes, tabs for indentation, strict equality (`===`).
- PascalCase for components, kebab-case for filenames.
- Only Sarvam AI keys/credits.
- Responsive design for mobile & desktop.

---

### Task 1: Refactor `components/pricing-plans.tsx` with `isLandingPage` Prop & Explicit Collaborator Limits

**Files:**
- Modify: `components/pricing-plans.tsx`
- Modify: `components/landing-page.tsx`
- Test: `tests/unit/pricing-plans-landing.test.tsx`

**Interfaces:**
- Produces: `PricingMatrix({ currentPlan, isLandingPage }: { currentPlan?: string; isLandingPage?: boolean })`

- [ ] **Step 1: Write failing unit test for `isLandingPage` prop and collaborator limits**

Create `tests/unit/pricing-plans-landing.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, it, expect } from 'vitest'
import PricingMatrix from '@/components/pricing-plans'
import React from 'react'

describe('PricingMatrix Landing Page & Collaborator Limits', () => {
	it('displays Get started for Free plan CTA on landing page', () => {
		render(<PricingMatrix isLandingPage={true} />)
		const freeCta = screen.getByRole('button', { name: /Get started/i })
		expect(freeCta).toBeInTheDocument()
	})

	it('displays collaborator limits in feature lists', () => {
		render(<PricingMatrix />)
		expect(screen.getByText(/2 Collaborators max \/ document/i)).toBeInTheDocument()
		expect(screen.getByText(/10 Collaborators max \/ document/i)).toBeInTheDocument()
		expect(screen.getByText(/25 Collaborators max \/ document/i)).toBeInTheDocument()
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="/Users/harshdave/.nvm/versions/node/v23.11.0/bin:/opt/homebrew/bin:$PATH" && npx vitest run tests/unit/pricing-plans-landing.test.tsx`  
Expected: FAIL

- [ ] **Step 3: Update `components/pricing-plans.tsx` & `components/landing-page.tsx`**

In `components/pricing-plans.tsx`:
Add `isLandingPage?: boolean` prop. Update feature lists to include collaborator limits (`2 Collaborators max / document`, `10 Collaborators max / document`, etc.).  
In `components/landing-page.tsx`: pass `isLandingPage={true}` to `<PricingMatrix />`.

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="/Users/harshdave/.nvm/versions/node/v23.11.0/bin:/opt/homebrew/bin:$PATH" && npx vitest run tests/unit/pricing-plans-landing.test.tsx`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/pricing-plans.tsx components/landing-page.tsx tests/unit/pricing-plans-landing.test.tsx
git commit -m "feat: add isLandingPage prop to PricingMatrix and include explicit collaborator limits"
```

---

### Task 2: Update Profile Menu Credits Display & Mobile Bot Bar Responsiveness

**Files:**
- Modify: `components/profile-menu.tsx`
- Modify: `components/lekhan-bot-bar.tsx`
- Test: `tests/unit/profile-menu-credits.test.tsx`

**Interfaces:**
- Produces: `ProfileMenu` with AI Credits badge (`85 Left`).
- Produces: `LekhanBotBar` hiding credit badge on mobile (`hidden sm:inline-flex`).

- [ ] **Step 1: Write unit test for ProfileMenu credit badge**

Create `tests/unit/profile-menu-credits.test.tsx`:
```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, it, expect, vi } from 'vitest'
import ProfileMenu from '@/components/profile-menu'
import React from 'react'

vi.mock('next/navigation', () => ({
	useRouter: () => ({ push: vi.fn() }),
}))

describe('ProfileMenu Credit Badge', () => {
	it('displays AI Credits status pill when dropdown is opened', () => {
		render(<ProfileMenu user={{ email: 'user@example.com', full_name: 'Test User' }} />)
		const avatarBtn = screen.getByRole('button', { name: /TU/i })
		fireEvent.click(avatarBtn)

		expect(screen.getByText(/AI Credits/i)).toBeInTheDocument()
		expect(screen.getByText(/85 Left/i)).toBeInTheDocument()
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="/Users/harshdave/.nvm/versions/node/v23.11.0/bin:/opt/homebrew/bin:$PATH" && npx vitest run tests/unit/profile-menu-credits.test.tsx`  
Expected: FAIL

- [ ] **Step 3: Update `components/profile-menu.tsx` and `components/lekhan-bot-bar.tsx`**

In `components/profile-menu.tsx`: add credits row in dropdown header.  
In `components/lekhan-bot-bar.tsx`: update credit badge span to `hidden sm:inline-flex`.

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="/Users/harshdave/.nvm/versions/node/v23.11.0/bin:/opt/homebrew/bin:$PATH" && npx vitest run tests/unit/profile-menu-credits.test.tsx`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/profile-menu.tsx components/lekhan-bot-bar.tsx tests/unit/profile-menu-credits.test.tsx
git commit -m "feat: add credits pill to profile menu and hide credit badge on mobile bot bar"
```

---

### Task 3: Implement DB Credit Tracking & Plan Enforcement Helpers in `services/db.ts`

**Files:**
- Modify: `services/db.ts`
- Test: `tests/unit/db-credits-limits.test.ts`

**Interfaces:**
- Produces: `getUserAICredits(userId: string): Promise<UserAICredits>`
- Produces: `deductUserAICredits(userId: string, amount: number): Promise<UserAICredits>`
- Produces: `checkCanAddCollaborator(documentId: string, currentCollaboratorCount: number, plan: string): { canAdd: boolean; limit: number }`

- [ ] **Step 1: Write unit test for DB credit and plan limit helpers**

Create `tests/unit/db-credits-limits.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { checkCanAddCollaborator, getPlanCollaboratorLimit } from '@/services/db'

describe('Plan Limit Enforcement Helpers', () => {
	it('returns correct collaborator limit per plan tier', () => {
		expect(getPlanCollaboratorLimit('free')).toBe(2)
		expect(getPlanCollaboratorLimit('go')).toBe(10)
		expect(getPlanCollaboratorLimit('pro')).toBe(25)
		expect(getPlanCollaboratorLimit('team')).toBe(50)
	})

	it('enforces collaborator count check correctly', () => {
		expect(checkCanAddCollaborator(1, 'free').canAdd).toBe(true)
		expect(checkCanAddCollaborator(2, 'free').canAdd).toBe(false)
		expect(checkCanAddCollaborator(9, 'go').canAdd).toBe(true)
		expect(checkCanAddCollaborator(10, 'go').canAdd).toBe(false)
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="/Users/harshdave/.nvm/versions/node/v23.11.0/bin:/opt/homebrew/bin:$PATH" && npx vitest run tests/unit/db-credits-limits.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implement functions in `services/db.ts`**

Add `getPlanCollaboratorLimit`, `checkCanAddCollaborator`, `getUserAICredits`, and `deductUserAICredits` to `services/db.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="/Users/harshdave/.nvm/versions/node/v23.11.0/bin:/opt/homebrew/bin:$PATH" && npx vitest run tests/unit/db-credits-limits.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/db.ts tests/unit/db-credits-limits.test.ts
git commit -m "feat: add user AI credit tracking and plan collaborator limit helpers in db.ts"
```

---

### Task 4: Add Dedicated Usage Tab in Settings (`components/settings-client.tsx`)

**Files:**
- Modify: `components/settings-client.tsx`
- Test: `tests/unit/settings-usage-tab.test.tsx`

**Interfaces:**
- Produces: 4-tab Settings page (`Profile & Security`, `Collaborators & Access`, `Usage & Credits`, `Billing & Subscription`).
- Displays Credit Progress Card, ≤10% Low Credit Warning Banner, Depleted Credit Alert with BYOK fallback, and Sarvam AI Credit Cost Reference Table.

- [ ] **Step 1: Write unit test for Usage tab in Settings**

Create `tests/unit/settings-usage-tab.test.tsx`:
```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, it, expect, vi } from 'vitest'
import SettingsClient from '@/components/settings-client'
import React from 'react'

describe('Settings Usage & Credits Tab', () => {
	it('renders 4 tabs and switches to Usage & Credits tab', () => {
		render(<SettingsClient user={{ email: 'test@example.com' }} token="mock" />)
		const usageTab = screen.getByRole('button', { name: /Usage & Credits/i })
		expect(usageTab).toBeInTheDocument()

		fireEvent.click(usageTab)
		expect(screen.getByText(/AI Credit Consumption/i)).toBeInTheDocument()
		expect(screen.getByText(/Sarvam AI Service Rates/i)).toBeInTheDocument()
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="/Users/harshdave/.nvm/versions/node/v23.11.0/bin:/opt/homebrew/bin:$PATH" && npx vitest run tests/unit/settings-usage-tab.test.tsx`  
Expected: FAIL

- [ ] **Step 3: Update `components/settings-client.tsx`**

Add `Usage & Credits` tab with Credit Progress Card, Low Credit Warning Banner (triggers when remaining ≤ 10%), Depleted Credit state with BYOK fallback notice, and Sarvam AI rates table.

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="/Users/harshdave/.nvm/versions/node/v23.11.0/bin:/opt/homebrew/bin:$PATH" && npx vitest run tests/unit/settings-usage-tab.test.tsx`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/settings-client.tsx tests/unit/settings-usage-tab.test.tsx
git commit -m "feat: add dedicated Usage & Credits tab in Settings with progress card, low credit banner, and Sarvam rate table"
```

---

### Task 5: Dynamic Plan Retention Reassurance in `components/version-history.tsx`

**Files:**
- Modify: `components/version-history.tsx`
- Test: `tests/unit/version-history-reassurance.test.tsx`

**Interfaces:**
- Produces: Dynamic version history retention badge/reassurance based on active plan.

- [ ] **Step 1: Write unit test for Version History retention reassurance note**

Create `tests/unit/version-history-reassurance.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, it, expect } from 'vitest'
import VersionHistory from '@/components/version-history'
import React from 'react'

describe('VersionHistory Retention Reassurance', () => {
	it('displays plan-specific retention reassurance note', () => {
		render(
			<VersionHistory
				documentId="doc1"
				isOpen={true}
				onClose={() => {}}
				onSelectVersion={() => {}}
				plan="free"
			/>
		)
		expect(screen.getByText(/7-day cloud & local version history included in Free plan/i)).toBeInTheDocument()
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="/Users/harshdave/.nvm/versions/node/v23.11.0/bin:/opt/homebrew/bin:$PATH" && npx vitest run tests/unit/version-history-reassurance.test.tsx`  
Expected: FAIL

- [ ] **Step 3: Update `components/version-history.tsx`**

Add dynamic retention reassurance note based on `plan` prop (Free: 7 days, Go: 14 days, Pro: 90 days, Team: 1 year).

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="/Users/harshdave/.nvm/versions/node/v23.11.0/bin:/opt/homebrew/bin:$PATH" && npx vitest run tests/unit/version-history-reassurance.test.tsx`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add components/version-history.tsx tests/unit/version-history-reassurance.test.tsx
git commit -m "feat: add dynamic plan retention reassurance note in VersionHistory panel"
```

---

### Task 6: Full Suite Verification & Build Check

**Files:**
- Full Vitest test suite & Next.js production build

- [ ] **Step 1: Run unit tests**

Run: `export PATH="/Users/harshdave/.nvm/versions/node/v23.11.0/bin:/opt/homebrew/bin:$PATH" && npx vitest run`  
Expected: All unit tests pass cleanly.

- [ ] **Step 2: Run Next build check**

Run: `export PATH="/Users/harshdave/.nvm/versions/node/v23.11.0/bin:/opt/homebrew/bin:$PATH" && npm run build`  
Expected: Build succeeds with 0 errors.

- [ ] **Step 3: Commit**

```bash
git commit --allow-empty -m "chore: verify Usage tab, DB credit tracking, mobile bot bar, and plan retention enforcement"
```
