# Mentions Feature, Revamped Tabbed Settings, & INR Pricing Model Design Document

**Date**: 2026-07-23  
**Status**: Draft / Approved for Implementation  
**Target Scope**: Lekhan Editor, Settings Page, Landing Page, Database Services, AI Metering  

---

## 1. Executive Summary

This design document outlines the architecture for three key upgrades to **Lekhan**:
1. **TipTap Mentions Feature**: Autocomplete `@mention` suggestions in the editor for document Owners & Editors (excluding Viewers).
2. **Revamped Tabbed Settings Page**: Clean, modern sidebar/top navigation for Profile & Security, Collaborators & Access, and Billing & Subscription.
3. **INR Pricing & Tier Enforcement System**: A 5-tier pricing model tailored for the Indian market (Free, Go ₹99, Pro ₹499, Team ₹499/seat, Enterprise) featuring generous AI credit metering with **Bring Your Own Key (BYOK)** fallback, and concurrent editor caps.

---

## 2. TipTap Mentions Feature Architecture

### 2.1 Overview & Permission Rules
- **Permission Matrix**:
  - Document **Owners** & **Editors** can trigger the `@` suggestion popup and tag other collaborators.
  - Document **Viewers** are read-only and cannot edit or trigger `@` mentions.
  - Viewers are **excluded** from the mention autocomplete suggestion dropdown (only Owners and Editors of the current document appear).

### 2.2 Data Layer & Database Services
Add `fetchMentionableCollaborators(documentId)` in `services/db.ts`:
- Queries `documents` table to retrieve `owner_id` (joined with `profiles`).
- Queries `document_members` table where `document_id = documentId` AND `role = 'editor'` (joined with `profiles`).
- Excludes any members with `role = 'viewer'`.
- Returns `Array<{ id: string, email: string, full_name: string, avatar_url?: string }>`.

### 2.3 TipTap Extension Integration
- **Package**: `@tiptap/extension-mention`
- **Configuration** in `components/editor-workspace.tsx`:
  - `suggestion`: Triggers on `@` keypress.
  - `items`: Filters mentionable collaborators matching typed text.
  - `render`: Uses Tippy.js to mount a React component `MentionList` (matching the existing `SlashMenuComponent` pattern).
- **DOM Badge Styling**:
  - Inline mention node rendered with class `.mention-badge`:
    `bg-primary-container/30 text-primary border border-primary/20 rounded-md px-1.5 py-0.5 font-medium text-sm inline-flex items-center gap-1`

---

## 3. Revamped Tabbed Settings Page (`components/settings-client.tsx`)

### 3.1 Layout & Navigation
- Convert current single-scroll `settings-client.tsx` into a responsive tabbed workspace:
  - **Desktop**: Vertical sidebar tabs (`Profile & Security`, `Collaborators & Access`, `Billing & Plans`).
  - **Mobile**: Horizontal scrollable tab pills.
  - Active tab state controlled via `activeTab` state (`'profile' | 'collaborators' | 'billing'`).

### 3.2 Tab Content Sections
1. **👤 Profile & Security**:
   - Full Name & Email display.
   - Password Update Form with validation & re-authentication trigger.
   - **BYOK (Bring Your Own API Key)** section for custom Gemini / Sarvam API keys.
2. **👥 Collaborators & Access**:
   - List owned documents and their member permissions.
   - Quick action to remove members or copy invite links.
3. **💳 Billing & Subscription**:
   - Active Plan Badge (e.g. `Free`, `Go`, `Pro`, `Team`).
   - Remaining AI Credits counter display (`"85 Credits left"`).
   - Embedded `<PricingMatrix />` component with simulated upgrade flow.

---

## 4. INR Pricing Matrix & Tier Enforcement

### 4.1 5-Tier Pricing Matrix (INR)

| Tier | Price (INR) | AI Credits / Mo | Credit Exhaustion Handling | Concurrent Editors Cap | Version History | Features |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Free** | **₹0** / mo | **50 Starter Credits** | BYOK (User adds API Key for unlimited AI) | **2 Editors** max / doc | 3 Days | 5 Docs max, Mentions view-only |
| **Go** | **₹99** / mo | **500 Credits** / mo | BYOK (Falls back to user API key) | **5 Editors** max / doc | 14 Days | Unlimited Docs, Mentions, PDF Export |
| **Pro** | **₹499** / mo | **2,500 Credits** / mo | BYOK (Falls back to user API key) | **25 Editors** max / doc | 90 Days | Priority Sync, Full Mentions, Priority Support |
| **Team** | **₹499** / seat / mo | **3,500 Credits** / seat / mo | BYOK (Falls back to team/user API key) | **50 Editors** max / doc | 1 Year | Centralized Billing, Admin Controls, Team Workspace |
| **Enterprise**| **Custom** (*Contact Us*) | **Custom / Unlimited** | Custom / BYOK | **Unlimited** | Unlimited | Dedicated Instance, Custom SLA, SSO |

### 4.2 Technical Enforcements
1. **AI Credit Counter & Display**:
   - Display `"X Credits left"` (e.g., `"85 Credits left"`).
   - When credits reach 0, prompt user to add their own API key (BYOK) or upgrade their plan.
2. **Concurrent Editor Cap**:
   - Checked during Yjs WebSocket connection establishment (`useEditorCollab`).
   - If active online editors exceed the document owner's plan cap (e.g. >2 on Free), additional users connect in **Read-Only / Viewer** mode with an informative banner.
3. **Landing Page Integration**:
   - Shared `<PricingMatrix />` rendered on `app/page.tsx` with Monthly/Yearly toggle (Save 20%) and "Get Started" / "Upgrade" call-to-actions.

---

## 5. Next Steps
1. User spec review gate.
2. Implementation plan generation via `writing-plans` skill.
