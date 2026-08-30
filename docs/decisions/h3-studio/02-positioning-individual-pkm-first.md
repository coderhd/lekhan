---
tags: [decision, h3-studio, positioning]
status: decided
date: 2026-08-29
---

# H3 Studio: position as individual/PKM-first RAG, not Confluence-replacement

**Decision:** Go-to-market framing for Studio is "NotebookLM built into the notes you already keep, fully local if you want it" — not "AI-native office suite to replace Confluence for teams."

**Why:** A team/Confluence-replacement framing competes directly with Atlassian's Rovo, which already ships semantic search, summarization, and agents natively inside Confluence — better-resourced and better-integrated than anything composed from Claude + a generic MCP connector. Testing the pitch against "why would a team choose us over Claude + Confluence MCP" surfaced that most of the apparent differentiators (BYOK, citations, page creation) are matched or exceeded by Rovo; the differentiators that actually hold up — a single trust boundary, full offline capability, output re-entering the same linked graph it came from — are the same three things Lekhan already leans on against Obsidian/Notion, not new team-specific value. This also matches the product's current stated ICP (individual Obsidian users) rather than a persona (IT/enterprise) the product hasn't built for yet.

**Precedent considered:** Obsidian has enterprise customers today (companies buying bulk Sync seats) without ever building or marketing team features — team revenue was a byproduct of being excellent at the individual use case, not a targeted wedge. Expected same pattern here.

**Related:** [[01-one-architecture-not-team-vs-individual]], [[chatgpt-strategy-summary-2026-08-29]]
