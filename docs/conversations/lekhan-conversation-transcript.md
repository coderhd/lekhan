# Conversation Transcript

**Date:** August 29, 2026

---

## User

What is the ARR of Notion and Obsidian?

## Assistant

As of **2026**, the best available estimates are:

| Company | ARR | Status | Employees |
|---|---:|---|---:|
| **Notion** | **~$865M** | Estimated, July 2026 | ~1,000 |
| **Obsidian** | **~$25M** | Estimated, 2026 | ~9 |

### Notion

Notion is now a **very large SaaS business**. Forbes reported that it had passed **$600M ARR in late 2025**, with roughly half coming from AI products.

More recent third-party analysis estimates **~$865M ARR in July 2026**, implying ~82% YoY growth.

So I'd use **$800–900M ARR** as the reasonable current range, with **$865M** as the latest estimate rather than a company-confirmed figure.

Notion was valued at **$11B** in its January 2026 employee tender, putting the valuation at roughly **13× the latest estimated ARR**.

### Obsidian

This one is much more interesting.

Obsidian is estimated at around **$25M ARR**, despite having only **~9 employees**.

Importantly, **Obsidian itself hasn't publicly confirmed the $25M ARR figure**, so I'd treat it as an external estimate rather than a hard number.

The Verge's 2025 interview with CEO Steph Ango confirmed that the company is **profitable and extremely lean**, with revenue primarily coming from **Obsidian Sync, Publish, and related services**.

### The crazy part

The comparison is roughly:

**Notion:**

> ~$865M ARR / ~1,000 employees ≈ **$865K ARR per employee**

**Obsidian:**

> ~$25M ARR / ~9 employees ≈ **$2.8M ARR per employee**

So Obsidian could be doing **3×+ the ARR per employee** of Notion.

And that's what makes Obsidian particularly fascinating as a business model: **a tiny team, no mandatory account, local-first architecture, no VC-fueled growth machine, and a relatively simple paid Sync/Publish model**, yet potentially ~$25M/year in recurring revenue.

If you're asking because you're thinking about **building something in the Notion/Obsidian space**, the economics of Obsidian are actually much more interesting than Notion's.

---

## User

Here's the product that I am making. Check: https://github.com/coderhd/lekhan

## Assistant

Yes — I checked the actual repo rather than just the GitHub description.

And **now the Notion/Obsidian ARR comparison makes much more sense** in the context of what you're building.

### My read of Lekhan

The core proposition is:

> **Obsidian's ownership + Notion's collaboration + AI that doesn't require giving up control of your data.**

Your README describes it as an **AI-native collaborative knowledge workspace**, with local-first/offline editing, CRDT collaboration, Markdown interoperability, knowledge graph functionality, BYOK AI, and eventually local LLM support.

More importantly, your internal product definition is unusually clear: your initial customer is specifically an **Obsidian user who wants real-time collaboration and AI without cloud lock-in or per-feature AI fees**.

That is a much sharper starting point than "Notion but better."

### And I think there's a potentially very interesting business here

The interesting question isn't:

**"Can Lekhan beat Notion?"**

It is:

**"Can Lekhan capture the gap that exists between Obsidian and Notion?"**

I'd visualize the market roughly like this:

| | Local / owned | Cloud / managed |
|---|---|---|
| **Individual PKM** | **Obsidian** | Notion |
| **Collaboration** | Weak historically | **Notion** |
| **AI** | Bring your own / fragmented | Notion AI |
| **Lekhan** | **← this intersection** | |
| **Teams** | ? | Notion |

Your product is effectively trying to move **Obsidian's philosophy into the collaborative era**, while bringing enough of Notion's structure to make it useful for teams.

And your roadmap confirms that direction: databases, mobile, publishing, plugins/open-core, team workspaces and eventually an AI-native office suite.

---

### But there's one thing I'd be very careful about

Your **architecture is potentially more differentiated than your feature list**.

"Markdown + backlinks + graph + AI + collaboration" is increasingly becoming table stakes.

The really interesting thing is:

> **Your files remain yours, while the same underlying knowledge can participate in real-time collaborative editing.**

That's substantially more difficult to copy than "we have an AI assistant."

Your product document explicitly identifies this as the architectural differentiator: notes live as files on the user's disk while CRDT collaboration operates over them.

I'd lean extremely hard into that.

### In other words:

Don't position Lekhan as:

> **Notion + Obsidian + AI**

That's understandable, but weak.

I'd position it more like:

> **Your knowledge shouldn't become hostage to your productivity app.**

Then demonstrate:

**Your files → Lekhan → collaboration → AI → export anywhere**

rather than:

**Lekhan → proprietary database → hope the user can migrate later.**

That's much closer to the reason Obsidian has such a devoted user base.

---

## User

Yes. I would love that

## Assistant

Absolutely. I went deeper this time: I checked the current Lekhan repository/roadmap as well as the current positioning and pricing of Notion, Obsidian, Anytype and AFFiNE.

My conclusion is stronger than my first reaction:

> **Lekhan has a real wedge. But the wedge is not "AI + Obsidian + Notion." It is "collaboration without surrendering ownership of your knowledge."**

And I think that distinction should influence almost every product and business decision you make.

---

# 1. The market you're actually entering

The landscape is roughly:

| Product | Core philosophy | Collaboration | Local ownership | AI | Structured data |
|---|---|---:|---:|---:|---:|
| **Obsidian** | Own your Markdown | 🟡 | 🟢🟢🟢 | 🟡 via ecosystem | 🟡 |
| **Notion** | Cloud workspace | 🟢🟢🟢 | 🔴 | 🟢🟢🟢 | 🟢🟢🟢 |
| **Anytype** | Sovereign workspace | 🟢 | 🟢🟢🟢 | 🟢 | 🟢🟢 |
| **AFFiNE** | Open-source Notion alternative | 🟢🟢 | 🟢🟢 | 🟢 | 🟢🟢 |
| **Lekhan** | Owned knowledge + collaboration | 🟢🟢 | 🟢🟢 → 🟢🟢🟢 | 🟢 → 🟢🟢🟢 | 🟡 → 🟢🟢 |

The interesting thing is that **the market has already validated your thesis**.

Anytype now says it has **1M+ accounts and 100K+ MAU**, and has launched a €20/editor/month business product around local-first sovereignty.

AFFiNE claims **200K+ Pro users and 70K+ GitHub stars**, with local-first docs, collaboration, databases, AI and self-hosting.

So "people don't care about local-first" is clearly not true.

---

# 2. But there is an important difference between Lekhan and these competitors

Looking at your actual repo, Lekhan currently has:

- Yjs CRDT collaboration
- real-time cursors
- Markdown round-trip
- Obsidian vault import
- Wikilinks
- knowledge graph foundation
- encrypted snapshots
- RBAC
- version history
- global search
- AI assistant
- multiple AI providers
- planned BYOK
- planned local `llama.cpp`
- planned Tauri desktop vault
- planned Notion importer
- planned databases
- planned publishing
- planned mobile
- planned plugins

That's a **lot**.

Your README describes the product as:

> "Local-first like Obsidian. Collaborative like Notion. AI on your terms."

I like the sentence.

But I would make one important distinction.

## Today vs destination

Your **destination architecture** is compelling:

**Files on user's machine**
↓  
**Lekhan editor**
↓  
**CRDT collaboration**
↓  
**AI**
↓  
**optional cloud infrastructure**

But your current architecture is more like:

**Browser**
↓  
**Lekhan**
↓  
**Supabase**
↓  
**encrypted snapshots**

The actual vault-on-disk/Tauri architecture is still in the roadmap.

That's important because **"local-first" is not just a marketing adjective**.

Obsidian's moat comes partly from the fact that its fundamental object is a Markdown file sitting on your filesystem.

So I would make **vault-on-disk + collaboration** the architectural milestone you protect above almost everything else.

---

# 3. Your biggest competitor isn't actually Notion

It's **Obsidian + Sync**.

This is the scenario you need to beat:

> "I already have 8,000 Markdown files in Obsidian. Why should I move?"

Obsidian's answer is remarkably strong:

**Don't move.**

You keep your files.

Need multiple devices?

Buy Sync.

Need publishing?

Buy Publish.

Obsidian Sync is one of its major revenue drivers.

And Publish is currently $8/site/month annually.

That's an exceptionally elegant business model.

---

# 4. This is where Lekhan can attack

Imagine an Obsidian user has:

```text
~/MyVault/
    Projects/
    Research/
    Books/
    Journal/
    Ideas/
    Work/
```

Today:

### Obsidian

Excellent solo experience.

But:

> "Let's work on this document together."

Suddenly you need:

- Obsidian Sync
- shared vault mechanisms
- Git
- plugins
- external collaboration tools
- or move the document elsewhere.

### Lekhan

The proposition becomes:

> **Open your vault → invite someone → work together.**

Same knowledge.

Same links.

Same Markdown.

But now:

```text
Harsh ─────┐
           ├── CRDT ── Shared Knowledge
Teammate ──┘
```

That is the product.

Not AI.

Not databases.

Not graphs.

**Collaborative ownership.**

---

# 5. The "killer feature" I'd build

## Shared Vault

I would make this the defining Lekhan feature.

Not simply:

> "Real-time collaborative documents."

That's Notion.

Instead:

> **"Collaborate directly on your Markdown knowledge base."**

The experience should eventually be:

### Step 1

Select a local folder:

```text
My Knowledge/
```

### Step 2

Lekhan indexes it.

### Step 3

Press:

**Share Vault**

### Step 4

Invite:

```text
harsh@example
alice@example
bob@example
```

### Step 5

Alice edits:

```markdown
# Product Research

The market is moving toward...
```

### Step 6

Harsh sees it immediately.

### Step 7

The change is merged into the actual local Markdown representation.

And importantly:

**If Lekhan disappears tomorrow, the user's knowledge doesn't.**

That is an extraordinarily strong proposition.

---

# 6. Why I would NOT lead with AI

This may sound strange given your product is explicitly AI-native.

But I think AI should be your **accelerator**, not your wedge.

Because AI is rapidly becoming table stakes.

Notion already has agents, meeting notes, enterprise search, research functionality and usage-based AI credits.

AFFiNE already markets AI across docs, whiteboards and knowledge workflows.

Anytype now has MCP support and AI-agent integrations as well.

So:

> **"Lekhan has AI"**

isn't defensible.

But:

> **"Lekhan lets AI work over knowledge that remains yours."**

is much more interesting.

And your BYOK/local inference roadmap makes that potentially credible.

---

# 7. Your AI architecture could become extremely powerful

I would eventually want something like:

```text
                  ┌──────────────┐
                  │  Your Vault  │
                  │   Markdown   │
                  └──────┬───────┘
                         │
              ┌──────────▼──────────┐
              │   Lekhan Knowledge  │
              │       Graph         │
              └───────┬─────┬──────┘
                      │     │
              ┌───────▼─┐ ┌─▼────────┐
              │ Local AI │ │ Cloud AI │
              │ llama.cpp│ │ BYOK     │
              └──────────┘ └──────────┘
```

Then the user chooses:

**Local model**

or

**OpenAI**

or

**Claude**

or

**Sarvam**

or eventually whatever provider they want.

That makes Lekhan fundamentally different from:

> "Here is our AI."

It's:

> **"Here is your knowledge. Choose the intelligence that operates on it."**

That's a much better long-term position.

---

# 8. Competitive analysis

## 🟠 Obsidian

### Strengths

- Incredible Markdown compatibility
- huge plugin ecosystem
- enormous community
- local files
- no mandatory account
- extremely low infrastructure burden
- very strong trust
- profitable, lean business

External estimates put Obsidian around **$25M ARR with only ~9 employees**, although this isn't officially confirmed by Obsidian.

### Weaknesses

- Collaboration isn't its center of gravity
- UX can be intimidating
- plugins can create ecosystem fragmentation
- databases are less native than Notion
- AI is not core
- teams aren't its natural market

### Lekhan opportunity

**"Obsidian, but collaboration is a first-class primitive."**

---

# 9. 🔵 Notion

Notion is the monster.

Current pricing is:

- Free
- $10/user/month Plus
- $20/user/month Business
- Enterprise custom

and AI is increasingly integrated into Business/Enterprise.

Sacra estimates Notion at approximately **$865M ARR in July 2026**, up from ~$610M at the end of 2025.

### Strengths

Basically everything:

- polished UX
- collaboration
- databases
- permissions
- templates
- integrations
- enterprise
- AI
- brand
- massive distribution

### Weakness

**Ownership.**

Notion is fundamentally a cloud workspace.

Your knowledge lives inside Notion's system.

That's exactly where Lekhan can disagree philosophically.

### Lekhan's answer

Don't try to make a better Notion.

Make:

> **The workspace where Notion users can finally own the underlying knowledge.**

---

# 10. 🟣 Anytype

This is probably your **most dangerous competitor**.

Not Notion.

Not Obsidian.

**Anytype.**

Because they're already going directly after the thesis you're pursuing.

They now have:

- local-first
- E2E encryption
- P2P sync
- offline operation
- self-hosting
- knowledge graphs
- databases
- team workspaces
- SSO
- AI/MCP
- enterprise positioning

And they claim 1M+ accounts and 100K+ MAU.

Their business pricing is currently:

**€20/editor/month**

with a planned self-hosted business option at **€300/month flat**.

### This is actually good news.

It proves there is a market.

But it means you cannot simply say:

> Local-first + collaborative + private.

**Anytype already owns that sentence.**

Your differentiation has to be sharper.

---

# 11. 🟢 AFFiNE

AFFiNE is the other competitor I'd watch very closely.

It combines:

- docs
- databases
- whiteboards
- collaboration
- AI
- local-first
- open source
- self-hosting

Its current Pro plan is around $6.75/month annually and Team is $10/seat/month.

They claim 200K+ Pro users and 70K+ GitHub stars.

### Their philosophy

> **"Open-source Notion."**

### Lekhan's philosophy should be different

> **"Collaborative Obsidian."**

That's a much cleaner wedge.

---

# 12. The positioning I'd use

I would actually move away from:

> AI-native collaborative knowledge workspace

as the primary headline.

It's accurate but generic.

I'd test:

### Option A

> **Your knowledge. Your files. Now collaborative.**

### Option B

> **The collaborative workspace for people who own their data.**

### Option C

> **Obsidian for teams. Without giving up your files.**

### Option D

> **Your second brain shouldn't belong to your SaaS provider.**

My favorite is:

> **Your knowledge. Your files. Now collaborative.**

Then:

> Local-first like Obsidian. Collaborative like Notion. AI on your terms.

That makes the second line explanatory rather than the entire positioning.

---

# 13. Your roadmap is currently too broad

This is probably my biggest product criticism.

Your roadmap eventually contains:

- PKM
- collaboration
- databases
- AI agents
- teams
- publishing
- mobile
- plugins
- sheets
- slides
- mail
- chat

That's basically:

> **"Build Notion."**

And that's dangerous.

You don't have Notion's resources.

Your advantage is that you're small.

So I would collapse the roadmap around one narrative.

## Phase 1

### Collaborative Markdown

Obsidian compatibility + local files + real-time collaboration.

## Phase 2

### Collaborative Knowledge

Graph + search + databases + publishing.

## Phase 3

### Knowledge AI

BYOK + local models + agents operating over the graph.

## Phase 4

### Team Knowledge OS

Teams, permissions, workflows, enterprise.

And I'd put:

**Sheets / Slides / Mail / Chat**

way, way later.

Possibly never.

Notion itself appears to be increasingly focusing on becoming an agent layer across existing SaaS rather than simply rebuilding every productivity application.

You don't want to spend years recreating Google Workspace.

---

# 14. The business model I would pursue

Here's where Obsidian is an incredible reference.

Obsidian monetizes **services around the local product**.

That's exactly the model I'd investigate for Lekhan.

### Free

```text
Local Markdown
Unlimited pages
Basic graph
Basic AI with BYOK
Single-user
```

### Personal

**$5–8/month**

```text
Cloud sync
Version history
AI routing
Publishing
Multi-device
```

### Collaboration

**$10–15/user/month**

```text
Shared vaults
Real-time collaboration
Permissions
Team graph
Comments
Team AI
```

### Pro / Business

**$20–30/user/month**

```text
Advanced AI
Agents
SSO
Audit logs
Admin
Advanced encryption
Enterprise support
```

### Self-hosted

Potentially:

**$X/month per deployment**

or an annual commercial license.

---

# 15. Don't make AI usage your primary pricing axis

This is important.

I'd avoid:

> 500 AI messages/month

> 10 AI credits

> 100 generations

because that's exactly the commoditized AI SaaS model you're trying to escape.

Instead:

### BYOK

User pays OpenAI/Anthropic/Sarvam directly.

Lekhan charges for:

**the workspace.**

That means:

> **You aren't selling tokens. You're selling the operating environment for someone's knowledge.**

That is much more defensible.

---

# 16. And your India advantage is bigger than it looks

Your inclusion of **Sarvam AI** isn't just a random provider integration.

It can eventually give Lekhan a genuine geographic wedge.

Imagine:

> English + Hindi + Gujarati + other Indian languages

with local models / BYOK.

A knowledge product that treats Indic languages as first-class could differentiate from Silicon Valley productivity software.

And your product documentation already explicitly identifies Sarvam as part of the multi-provider strategy.

I wouldn't make this your initial positioning, but it's an interesting second-order advantage.

---

# 17. Your $50K ARR milestone is actually quite reasonable

Your internal target is:

**500 paying workspaces → $50K ARR**

That's roughly:

**$100 ARR/workspace/year**

or:

**$8.33/month average.**

That's plausible.

And the really important metric isn't $50K.

It's:

> **Can 500 people who love Obsidian actually pay you to collaborate?**

If yes, you have something.

Then:

| Customers | Avg ARR/customer | ARR |
|---:|---:|---:|
| 500 | $100 | $50K |
| 2,000 | $120 | $240K |
| 5,000 | $150 | $750K |
| 10,000 | $180 | $1.8M |
| 25,000 | $200 | $5M |
| 50,000 | $220 | $11M |
| 100,000 | $250 | **$25M** |
| 250,000 | $300 | **$75M** |

And this is where the Obsidian comparison becomes exciting.

If Obsidian can plausibly reach ~$25M ARR with a tiny team, Lekhan doesn't need to become "the next Notion" to become a fantastic business.

---

# 18. My hypothetical Lekhan trajectory

If I were planning this as a founder, I'd target:

### $0 → $50K ARR

**Find the 500 people who desperately want this.**

Primary user:

> Serious Obsidian users who need collaboration.

Don't chase everyone.

### $50K → $1M

Build:

**The best collaborative Markdown experience on Earth.**

Forget:

- mail
- slides
- chat
- giant enterprise feature sets

Obsess over:

- import fidelity
- filesystem fidelity
- collaboration
- performance
- offline
- sync reliability
- conflict resolution
- backlinks
- search
- mobile

### $1M → $10M

Now introduce:

**Teams.**

The transition becomes:

```text
Person
  ↓
Personal vault
  ↓
Shared vault
  ↓
Team knowledge
  ↓
Team workspace
```

That's your natural expansion path.

### $10M → $50M

Now AI becomes much more important.

Not:

> "Chat with your documents."

Everyone will have that.

Instead:

> **AI that understands the entire knowledge graph.**

For example:

> "Find every decision we made about the authentication redesign and explain why we changed our mind."

Or:

> "Compare what we believed about this market six months ago with what we believe now."

Or:

> "Create a project brief from everything we've discussed about Project X."

That is where a graph-based knowledge system becomes genuinely interesting.

---

# 19. Your moat could eventually become this

Think about the stack:

```text
             ┌─────────────────────┐
             │      AI Agents      │
             └──────────┬──────────┘
                        │
             ┌──────────▼──────────┐
             │   Knowledge Graph   │
             └──────────┬──────────┘
                        │
             ┌──────────▼──────────┐
             │  Collaborative CRDT │
             └──────────┬──────────┘
                        │
             ┌──────────▼──────────┐
             │  User-owned Files   │
             └─────────────────────┘
```

Most competitors start at the **cloud workspace**.

Lekhan can start at the **file** and build upward.

That's the philosophical inversion.

---

# 20. One thing I'd change immediately

Your README currently lists **AI, collaboration, encryption, graphs, import/export, etc.** almost as peers.

I would reorganize the entire product narrative around three promises:

## ① Your files

Markdown. Obsidian compatibility. Exportability. Local-first.

## ② Your people

Real-time collaboration. Shared knowledge. Permissions.

## ③ Your intelligence

BYOK. Local models. AI agents. Knowledge graph.

That's a very coherent product.

---

# 21. The strategic map

If I were sitting beside you as a cofounder, I'd define Lekhan like this:

```text
                     NOTION
                       ▲
                       │
                collaboration
                       │
                       │
       ┌───────────────┼───────────────┐
       │             LEKHAN            │
       │                               │
ownership ─────────────┼─────────────── AI
       │                               │
       └───────────────┼───────────────┘
                       │
                       ▼
                    OBSIDIAN
```

But then there's:

**Anytype** → attacks sovereignty + collaboration

**AFFiNE** → attacks open-source + Notion

So Lekhan needs one additional axis:

# **Markdown-native collaborative knowledge**

That is where I'd plant the flag.

---

## My scorecard for Lekhan today

Based on what you've actually built/planned:

| Dimension | My score |
|---|---:|
| Product thesis | **9/10** |
| Market timing | **9/10** |
| Obsidian wedge | **9/10** |
| Technical ambition | **9/10** |
| Differentiation today | **6.5/10** |
| Differentiation after vault-on-disk | **9/10** |
| AI differentiation | **6/10** |
| Collaboration opportunity | **9/10** |
| Business model potential | **8.5/10** |
| Roadmap focus | **5.5/10** |
| Competitive risk | **High** |
| Potential to become a $10M+ ARR business | **Realistic if the wedge works** |

### And my biggest takeaway:

**I would not try to beat Notion.**

I would not even try to beat Obsidian.

I'd make **Obsidian users who need collaboration** so happy that they stop considering Notion.

Then expand outward.

That's a much smaller battle—and potentially a very large business.

Your own product principles already point in this direction: "Files stay files," user ownership, local-first architecture, and honest claims.

**The next thing I'd do is turn this analysis into an actual Lekhan strategy:** a **12-month product roadmap + pricing model + exact ICP + acquisition funnel + $0→$1M ARR model**, including which features I would *cut/postpone* from your current roadmap. That would be much more actionable than another competitor comparison.
