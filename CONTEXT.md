# Lekhan

The AI-native knowledge workspace: pages form one knowledge graph that views (editor, search, graph,
later databases) render over. Local-first like Obsidian, collaborative like Notion, AI on the user's
own keys or machine.

## Language

### Knowledge graph

**Workspace**:
The root container of a user's knowledge graph — the unit of ownership, billing, and collaboration.
_Avoid_: vault (except when importing foreign data), account, project

**Page**:
The universal node of the knowledge graph; holds content and properties, and can nest under another
page. _Avoid_: document, note, file

**Document**:
A legacy pre-graph page from the flat-table era. Exists only in migration contexts.
_Avoid_: using for current pages

**Page properties**:
Structured metadata attached to a page (frontmatter on import); the future substrate for typed views.
_Avoid_: frontmatter (UI language), metadata

**Page link**:
A directed connection from one page to another, created by a `[[wikilink]]`; may be unresolved when
the target title has no page yet. _Avoid_: backlink (that is the reverse view), internal link

**Backlink**:
The view of inbound page links to a given page. _Avoid_: mentions

**Tag**:
A `#tag` label on a page, indexed for filtering and the graph view. _Avoid_: category, label

**Graph index**:
The incrementally maintained store of links, tags, and search text derived from page content.
_Avoid_: search index, crawler

### Sync & storage

**Hub**:
The server-side sync layer every device replicates through; the only cross-device transport.
_Avoid_: backend, server (unqualified), cloud

**Replica**:
A device's own full local copy of a workspace's pages. _Avoid_: cache, mirror

**Sidecar**:
On desktop, the hidden per-workspace state accompanying the markdown files, carrying CRDT merge
state. _Avoid_: metadata folder, dotfile

**Merge-on-launch**:
Desktop behavior of merging hub state into the local replica and rewriting affected markdown files
with the merged result. _Avoid_: sync (unqualified), download

**Version**:
A named point-in-time snapshot of a page retained per tier. _Avoid_: history entry, backup,
revision

### Import

**Importer**:
A converter from a foreign source into Lekhan's graph via a shared pipeline. _Avoid_: migration
(reserved for our own schema/data migrations)

**Vault**:
An external Obsidian workspace being imported; never a Lekhan Workspace itself. _Avoid_:
using for native workspaces

**Import report**:
The honest fidelity summary shown after import: pages, links resolved, blocks degraded.
_Avoid_: log, summary

**Round-trip**:
Lossless conversion of page content editor → markdown → editor; the guardrail for import/export
fidelity. _Avoid_: export/import used loosely for this guarantee

### Access & AI

**Tier**:
A subscription level attached to a Workspace (Free, Plus, Pro, Team), unlocking seats, history,
sync, and privacy features. _Avoid_: plan (code legacy), subscription level

**Encrypt at rest**:
Default protection level: content encrypted on hub storage with server-held keys.
_Avoid_: E2E (reserved for the stronger level)

**E2E**:
Opt-in per-workspace encryption with client-held keys; trades away hub-side indexing features.
_Avoid_: zero-knowledge (marketing drift), encryption (unqualified)

**Provider registry**:
The config-driven list of AI providers a user connects; all inference runs on user keys or machines.
_Avoid_: AI settings, model picker

**BYOK**:
Bring your own key — cloud AI providers called directly with the user's API key.
**BYOL**:
Bring your own model — local inference endpoints (Ollama, LM Studio) on the user's machine.

**On-ramp**:
Guided first-AI-use flow connecting non-technical users to free-tier provider presets.
_Avoid_: free trial, credits
