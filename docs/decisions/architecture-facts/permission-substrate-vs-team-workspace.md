---
tags: [architecture-fact, permissions]
status: decided
date: 2026-08-29
---

# Permission substrate already exists independent of "Team workspace"

`page_members` and `can_access_page()` are shipped today (P1) — any Page can already be shared with named users, gated by role. "Team workspace" as a product — seats, billing, admin console, SSO — is the part gated behind H2 (#49, blocked on billing #29). These are two different things that are easy to conflate: a feature needing permission-aware access does not need to wait for team workspaces to ship; it only needs `can_access_page()`, which already exists. A workspace with fifty `page_members` is not architecturally different from one with one owner — it's just more rows in the same table.

**Why this note exists:** this distinction resolved what looked like a real architectural fork in [[01-one-architecture-not-team-vs-individual]] — worth not re-deriving from scratch next time a feature's scope seems to hinge on "team vs individual."
