# Growth ops — n8n marketing automation

Self-hosted n8n via Docker Compose. Workflows in this directory are importable
via n8n UI (Workflows → Import from File).

## Deploy

```bash
cd ops/n8n
docker compose up -d          # n8n on http://localhost:5678
```

Set a strong `N8N_BASIC_AUTH_*` before exposing beyond localhost. First-run
account is created in the UI.

## Workflows

### content-studio.json — primary marketing engine (HITL)

Weekly: reads idea seeds from a Content Calendar sheet → LLM adapts each seed
into platform-native drafts (X ≤240 chars punchy / LinkedIn narrative /
Instagram caption + visual brief) → appends to an approval Queue → human edits
and marks `approved` → compiles a copy-paste-ready weekly package for native
schedulers. **Never auto-publishes**; hard voice rules ban slop words, invented
metrics, and hashtag soup. Strategy: `docs/marketing/early-access-playbook.md`.

Conversion target: `/early` founding-cohort page (#85) → Brevo
`founding_waitlist` contacts.

### obsidian-community-listener.json

Ethical stance: **listen and draft, never auto-post.** Automated engagement in
Reddit communities violates both Reddit self-promotion rules and community
trust — the workflow surfaces relevant conversations so a human can choose to
engage genuinely.

Flow (every 6h):
1. Pull newest posts from r/ObsidianMD, r/PKMS, r/Notion (public .rss feeds)
2. Merge + dedupe by post id
3. Filter on intent keywords (collab/sync/notion/migrate/AI/self-host/publish)
4. Append qualified leads to a Google Sheet (review queue)
5. Email a digest with links

### community-engagement-drafter.json — human-in-the-loop LLM pipeline

The full loop: **automate everything except the decision and the send.**

1. Reads `status=pending` rows from the Leads sheet
2. LLM (any OpenAI-compatible endpoint — point it at a hosted API or a local
   model) classifies intent, scores relevance 0–10, drafts a reply under strict
   rules: help-first, honest about limitations, disclose affiliation when
   recommending Lekhan, null-draft when helping without mentioning us is better
3. Writes drafts back to the sheet (`draft_review` status)
4. Emails an approval digest; the human sets status:
   - `approved_reply` → human posts manually on Reddit (always manual there)
   - `approved_campaign` → folded into the next Brevo campaign draft
   - `rejected`
5. Brevo branch: approved_campaign rows are aggregated into a **Brevo DRAFT
   campaign** via API (`POST /v3/emailCampaigns`, `status: draft`) — campaigns
   are only ever *sent* from the Brevo UI by a human

**Where emails legitimately come from:** our own funnel only — beta signups,
waitlist opt-ins, in-app prompts → synced as tagged Brevo contacts. Communities
give signals, never addresses.

### Required credentials (owner provides)

| Credential | Used for | Where |
|---|---|---|
| Google Sheets OAuth2 | lead review queue | n8n → Credentials |
| SMTP (or Gmail OAuth2) | approval digests | n8n → Credentials |
| HTTP Header Auth (LLM key) | drafter LLM endpoint | n8n → Credentials |
| Brevo API key (`api-key` header) | contacts + draft campaigns | n8n → HTTP Request nodes |

### Future workflows (queued)

- `migration-guide-seo-monitor.json` — Search Console API → rank tracking for
  "import from Notion" keywords
- `beta-cohort-onboarding.json` — beta signup webhook → personalized follow-up
  sequence
