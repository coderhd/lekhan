# Spec #28: AI Provider Registry & Unified Settings Architecture

- **Status**: SPEC APPROVED (Ready for `/plan`)
- **Epic**: #28 (H0 — AI Provider Registry)
- **Author**: Antigravity Pair Programming Engine
- **Target Launch**: Sep 2 → Sep 10 (Lane A P0)

---

## 1. Executive Summary & Vision

Lekhan requires a **config-driven AI Provider Registry** and **Unified Settings Architecture** that eliminates friction for all users—from non-technical writers wanting a free, 3-minute setup to power users running local, offline LLMs via Ollama.

### Core Architectural Invariants
1. **Zero-Knowledge Key Storage**: API keys are encrypted client-side via AES-256-GCM (`lib/crypto.ts`) and backed up to `profiles.encrypted_ai_keys` in Supabase. Lekhan servers never store or see plaintext API keys.
2. **3-Tier AI Access Ladder**:
   - **Tier 1 (Local Offline / BYOL)**: Ollama / LM Studio / llama.cpp with localhost port detection.
   - **Tier 2 (Free-Key On-Ramp Presets)**: OpenRouter free models, Google Gemini free tier, Groq free tier with deep-linked signups.
   - **Tier 3 (Premium BYOK Cloud)**: Anthropic, OpenAI, Sarvam AI, and custom OpenAI-compatible endpoints with developer console deep links.
3. **Hybrid Inference Topology**:
   - **Localhost models**: 100% Client-direct (`http://localhost:11434`), zero latency, works fully offline.
   - **Cloud models**: Thin, stateless streaming route (`/api/ai/stream`) to bypass browser CORS constraints without persisting transcripts or keys.
4. **Unified Settings Experience**:
   - Retire obsolete, fragmented settings across the Editor and Main Dashboard.
   - Consolidate into a modern, 5-tab settings system (Web route `/settings` and an in-editor slide-out modal).
5. **Bot Bar & L1 Actions**:
   - Real-time model picker in the editor bot bar.
   - L1 text actions (Rewrite, Summarize, Translate, Fix Grammar, Continue Writing) with token-usage transparency.

---

## 2. The 3-Tier AI Access Ladder

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                       3-TIER AI ACCESS LADDER                               │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ 🏠 TIER 1: Local & Offline (BYOL / Sidecar)                           │  │
│  │ • Llama 4 Scout (17B), Qwen 3.8 (27B), Ministral 3 (14B), Llama 3.2   │  │
│  │ • Ollama, LM Studio, llama.cpp sidecar                                │  │
│  │ • Zero cost, 100% private, client-direct (http://localhost:11434)     │  │
│  │ • Live localhost port prober & 1-click CORS setup helper              │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                     │                                       │
│                                     ▼                                       │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ ⚡ TIER 2: Free-Key On-Ramp Presets (Zero Cost)                       │  │
│  │ • Gemini 3.7 Flash (Google AI Studio Free 15 RPM)                     │  │
│  │ • Llama 4 Maverick (Groq Free Fast Tier)                              │  │
│  │ • DeepSeek-V4-Flash & OpenRouter Free Models                          │  │
│  │ • GLM-5.3-Flash (Z.AI Free Tier)                                      │  │
│  │ • 3-minute guided on-ramp: Deep Link ↗ ➔ Paste Key ➔ Live Test        │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                     │                                       │
│                                     ▼                                       │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ 💎 TIER 3: Premium BYOK Cloud & Custom Endpoints                      │  │
│  │ • OpenAI: GPT-5.6 Sol, GPT-5.6 Terra, GPT-5.6 Luna, o3-pro, o4-mini   │  │
│  │ • Anthropic: Claude Opus 5, Claude Sonnet 5, Claude Haiku 4.5         │  │
│  │ • Google: Gemini 3.1 Pro, Gemini 2.5 Pro (2M Context)                 │  │
│  │ • DeepSeek: DeepSeek-V4-Pro (1M Context)                              │  │
│  │ • Alibaba: Qwen 3.8 Max (2.4T Dense)                                  │  │
│  │ • Z.AI: GLM-5.3 & GLM-5.2 (1M Context)                                │  │
│  │ • Sarvam AI: Sarvam-2B & Saarathi (Indic Multilingual)                │  │
│  │ • Custom OpenAI-compatible endpoints (Self-hosted vLLM, Together AI)  │  │
│  │ • Deep links to provider developer consoles ("Get Key ↗")             │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Data Model & Cryptographic Vault (`lib/crypto.ts`)

### 3.1. Provider Configuration Schema
```typescript
export type AIProviderType = 
  | 'ollama'
  | 'lmstudio'
  | 'openrouter'
  | 'gemini'
  | 'groq'
  | 'anthropic'
  | 'openai'
  | 'sarvam'
  | 'custom'

export interface AIProviderConfig {
  id: string
  provider: AIProviderType
  name: string
  enabled: boolean
  baseUrl?: string            // e.g. http://localhost:11434 for Ollama
  apiKey?: string             // Stored plaintext ONLY in memory, encrypted at rest
  defaultModel: string
  availableModels: string[]
  createdAt: string
  updatedAt: string
}

export interface AIRegistryState {
  activeProviderId: string
  activeModelId: string
  fallbackModelIds: string[]
  providers: Record<string, AIProviderConfig>
}
```

### 3.2. Zero-Knowledge Encryption at Rest
- Client encrypts `AIRegistryState` into binary envelope `LK_ENC_V1` using AES-256-GCM.
- Encrypted blob synced to Supabase `profiles.encrypted_ai_keys` column.
- On login/unlock, browser derives master key from session and decrypts state into memory.

---

## 4. Inference Routing Topology

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                          HYBRID INFERENCE ROUTER                            │
│                                                                             │
│                     [Editor Workspace / Bot Bar]                            │
│                                  │                                          │
│             Is provider local? (Ollama / LM Studio)                         │
│                    /                           \                            │
│                  YES                            NO (Cloud / BYOK)           │
│                  /                                \                         │
│                 ▼                                  ▼                        │
│     [Client-Direct Fetch]                  [POST /api/ai/stream]            │
│  fetch("http://localhost:11434/...")     (Stateless Next.js Edge Route)     │
│  • Direct streaming SSE                  • Injects key from request header  │
│  • Zero network latency                  • Streams response via SSE         │
│  • 100% offline operational              • Never stores prompts or keys     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Unified Settings Restructuring

Consolidate settings into 5 structured tabs:

```text
/settings & Editor Settings Drawer:
├── 🤖 1. AI Providers & Models
│   ├── Active Provider & Model Selector (with live latency & status badge)
│   ├── Tier 1: Local Models (Ollama Prober + CORS helper + Model refresh)
│   ├── Tier 2: Free On-Ramp Presets (OpenRouter, Gemini, Groq + Deep links)
│   └── Tier 3: Cloud Providers (Anthropic, OpenAI, Sarvam, Custom + Key inputs)
├── ⚙️ 2. General & Profile (Display name, email, workspace details)
├── 🎨 3. Editor & Appearance (Theme toggle, editor fonts, line height, spelling)
├── 💳 4. Plan & Usage (Tier limits, cloud history retention, collaborator quotas)
└── 🔒 5. Privacy & Encryption (E2E status, master key re-wrap, export/import)
```

---

## 6. Editor Bot Bar & L1 Action Integration

### 6.1. Bot Bar Model Selector
- Live model badge in bot bar: e.g. `[⚡ Llama 3.3 (Free)]` or `[🏠 Ollama: llama3.2]`.
- Quick-switch dropdown directly from the bot bar without navigating away.
- Per-response token counter display: `Output: 142 tokens · Latency: 1.1s`.

### 6.2. L1 Text Actions
- **Rewrite / Polish**: Improves tone and clarity.
- **Summarize**: Generates key takeaways.
- **Translate**: Multilingual translation (powered natively by Sarvam for Indic languages).
- **Fix Grammar & Spelling**: Clean proofreading.
- **Continue Writing**: Extends the current context.

---

## 7. Acceptance Criteria & Verification Plan

- [ ] **Data Security**: Unit tests verify API keys are never serialized in plaintext, never sent in GET URLs, and properly encrypted via `lib/crypto.ts`.
- [ ] **Localhost Prober**: Tested with mock Ollama HTTP endpoint and connection failure handling with actionable CORS guidance.
- [ ] **On-Ramp Wizard**: Interactive test verifies deep links, key entry, and live model test ping.
- [ ] **Hybrid Streaming**: Tested with Vitest & RTL covering SSE streaming chunks and error recovery.
- [ ] **Settings Tab Parity**: All 5 tabs render with proper ARIA tabs, keyboard navigation, and zero accessibility violations.
- [ ] **6-Stage Lifecycle Compliance**: Passes `npm run typecheck && npm run lint && npm test && npm run build` and Clean-Room Subagent Review Gate.
