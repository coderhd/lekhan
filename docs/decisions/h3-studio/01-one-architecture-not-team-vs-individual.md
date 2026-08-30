---
tags: [decision, h3-studio, architecture]
status: decided
date: 2026-08-29
---

# H3 Studio: one architecture, not a team/individual fork

**Decision:** Studio's retrieval and generation pipeline is gated only by the existing `can_access_page()` permission check. There is no separate "team mode" vs "individual mode" — a workspace with one owner and a workspace with fifty `page_members` run the identical code path.

**Why:** Studio was initially framed around a team-knowledge-base wedge, which raised real privacy/scope questions worth taking seriously. On examination, `page_members` and `can_access_page()` are already shipped (P1) and workspace-agnostic — see [[permission-substrate-vs-team-workspace]]. "Team workspace" as a *product* concept (seats, admin console, SSO) is what's gated behind H2 billing (#49), not the permission substrate Studio actually depends on. So there was never a real architectural fork to design around — just a framing habit worth dropping.

**Related:** [[02-positioning-individual-pkm-first]], [[permission-substrate-vs-team-workspace]]
