---
tags: [decision, h3-studio, architecture, architecture-fact]
status: decided
date: 2026-08-29
---

# The collaboration ↔ file-truth tradeoff, and how it's actually being mitigated

**The tradeoff:** true Notion-grade real-time multi-cursor collaboration requires a canonical state that can merge instantly (a CRDT/OT engine); a plain `.md` file cannot be that at every instant while multiple people edit concurrently. Obsidian avoided this by never building real-time collaboration — the file stays the single, always-live truth, at the cost of no simultaneous multiplayer editing. Lekhan made the opposite choice.

**What Lekhan actually does** (per [[0003-desktop-markdown-plus-yjs-sidecar]] / [[0004-server-hub-crdt-sync-topology]]): the Yjs CRDT doc, relayed through the hub, is canonical while connected and live-editing. The `.md` file is `MarkdownEngine.serialize()` output, written back as you go while online — and on desktop, reconciled with other devices' offline edits at `merge-on-launch`.

**What this mitigates, and what it doesn't:**
- Mitigated: the file is never an opaque, proprietary blob — it's real, readable Markdown at every point in time, exportable and grep-able regardless of sync state. This is the "never lock-in" half of the promise, fully preserved.
- Not mitigated: while offline, the on-disk file only reflects your own edits until the next reconnect/merge — it can lag the full multi-device truth by however long you were disconnected. Bounded, self-healing staleness, not permanent divergence, but a real gap from Obsidian's "the file is the live truth, always."

**Could Obsidian have built this instead?** Technically yes — the CRDT-canonical + periodically-reconciled-file pattern is proven buildable (Lekhan is the proof). The reason they didn't isn't a technical ceiling; it's that it requires running permanent server infrastructure (hub, durable WAL, sync ledger, monitoring, on-call) which conflicts with their deliberate choice to stay a small, mostly client-side team — and it would partially walk back the "zero required server dependency" claim their most loyal users value.

**Second, independent instance of the same three-way tension:** [[0001-encryption-at-rest-by-default-e2e-as-plus]] notes E2E workspaces lose server-side `searchable_text`/`page_links`, because the server can't index plaintext it can't see. Collaboration + privacy + real-time search is a three-way tradeoff; picking two always bends the third somewhere.

**Related:** [[0003-desktop-markdown-plus-yjs-sidecar]], [[0004-server-hub-crdt-sync-topology]], [[0001-encryption-at-rest-by-default-e2e-as-plus]]
