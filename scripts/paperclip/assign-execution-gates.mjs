#!/usr/bin/env node
/**
 * Assign execution gates (Reviewers, Approvers) to issues
 * based on a 1-10 complexity score. Deterministic; idempotent.
 *
 *   node scripts/paperclip/assign-execution-gates.mjs [--dry-run] [--all]
 *
 * Default targets: issues in `todo` / `in_progress` that have no execution stages yet.
 * `--all` also includes `in_review` and `blocked`.
 *
 * Complexity signals (labels + title/body keywords):
 *   base 3  ·  est:5 +2, est:8 +4  ·  epic|needs-spec +3  ·  h0 +2, h1 +1
 *   ·  billing|payment|stripe|razorpay|auth|encryption|sync|crdt|migration|security +2
 *   ·  ui|ux|design|frontend|page|component|layout|accessib|visual +2
 *   bands: 1-3 low · 4-6 medium · 7-10 high
 *   Title/body are read from the per-issue detail endpoint — the company list
 *   endpoint truncates `description` at 1200 chars and would under-score long
 *   bodies (keywords past the cutoff are invisible to the regexes).
 *
 * Gates:
 *   Reviewers : low [Tech Lead] · medium [TL, QA] · high [TL, QA] (+ Designer for UI work)
 *   Approvers : high only -> [CEO]
 *   Monitor   : not set by the routine — schedules extra wakes whose token cost
 *               outweighs value (removed by #126); add one by hand if needed
 *   Watchdog  : not set by the routine (same reason as Monitor)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const API = process.env.PAPERCLIP_API_URL ?? "http://127.0.0.1:3100";
const COMPANY = process.env.PAPERCLIP_COMPANY_ID ?? "b044e7dc-7bb3-46b8-a47f-596a3c75d879";
const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const ALL = args.includes("--all");

const KEY = (() => {
  if (process.env.PAPERCLIP_API_KEY) return process.env.PAPERCLIP_API_KEY;
  const p = path.join(os.homedir(), ".paperclip-onboarding", "paperclip.env");
  if (!fs.existsSync(p)) return null;
  const m = fs.readFileSync(p, "utf8").match(/PAPERCLIP_API_KEY=(.*)/);
  return m ? m[1] : null;
})();

async function api(method, p, body, auth = false) {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { ...(auth && KEY ? { Authorization: `Bearer ${KEY}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status} ${json?.error ?? text.slice(0, 160)}`);
  return json;
}

const agents = await api("GET", `/api/companies/${COMPANY}/agents`);
const byName = (n) => agents.find((a) => a.name === n)?.id ?? null;
const A = {
  tl: byName("Tech Lead"), qa: byName("QA Engineer"), designer: byName("UI/UX Designer"),
  po: byName("Product Owner"), ceo: byName("OpenCode Agent"),
};
for (const [k, v] of Object.entries(A)) if (!v) throw new Error(`missing agent: ${k}`);

const labels = await api("GET", `/api/companies/${COMPANY}/labels`);
const labelName = new Map(labels.map((l) => [l.id, l.name]));

const UI_RE = /(ui|ux|design|frontend|page|component|layout|accessib|visual)/i;
const HIGH_RE = /(billing|payment|stripe|razorpay|auth|encryption|sync|crdt|migration|security)/i;

function score(issue) {
  const names = (issue.labelIds ?? []).map((id) => labelName.get(id) ?? "");
  const text = `${issue.title} ${issue.description ?? ""}`;
  let s = 3;
  if (names.includes("est:5")) s += 2;
  if (names.includes("est:8")) s += 4;
  if (names.includes("epic") || names.includes("needs-spec")) s += 3;
  if (names.includes("h0")) s += 2;
  else if (names.includes("h1")) s += 1;
  if (HIGH_RE.test(text)) s += 2;
  if (UI_RE.test(text)) s += 2;
  return Math.min(10, s);
}
const band = (s) => (s <= 3 ? "low" : s <= 6 ? "medium" : "high");

function gatesFor(issue, s) {
  const b = band(s);
  const text = `${issue.title} ${issue.description ?? ""}`;
  const reviewers = [A.tl];
  if (b !== "low") reviewers.push(A.qa);
  if (b === "high" && UI_RE.test(text) && !/(billing|payment|stripe|razorpay)/i.test(text)) reviewers.push(A.designer);
  const stages = [{ type: "review", approvalsNeeded: 1, participants: reviewers.map((id) => ({ type: "agent", agentId: id })) }];
  if (b === "high") stages.push({ type: "approval", approvalsNeeded: 1, participants: [{ type: "agent", agentId: A.ceo }] });
  // Watchdog and Monitor are intentionally NOT set: they schedule extra agent
  // wakes (stall chases / scheduled re-checks) whose token cost outweighs their
  // value on most issues. Gates are reviewers + approvers only. Add a watchdog or
  // monitor by hand for the rare issue that genuinely needs one.
  return { band: b, score: s, stages };
}

const statuses = ALL ? ["todo", "in_progress", "in_review", "blocked"] : ["todo", "in_progress"];
const issues = await api("GET", `/api/companies/${COMPANY}/issues`);
const targets = issues.filter((i) => statuses.includes(i.status));

let assigned = 0, skipped = 0, unreadable = 0;
for (const issue of targets) {
  // The per-issue detail is the source of truth for BOTH the idempotency check
  // and scoring. The company list endpoint truncates `description` at 1200 chars
  // (descriptionTruncated: true) and serializes executionPolicy as null, so a
  // list-only pass both never skips already-gated issues and under-scores long
  // bodies whose complexity keywords fall past the cutoff. Fail closed: if the
  // detail cannot be read, skip the issue rather than re-gate or mis-score it.
  const detail = await api("GET", `/api/issues/${issue.id}`).catch((e) => {
    console.warn(`skip ${issue.identifier}: detail read failed: ${e.message}`);
    return null;
  });
  if (!detail) { unreadable++; continue; }
  const already = (detail.executionPolicy?.stages ?? []).length > 0;
  if (already) { skipped++; continue; }
  const s = score(detail);
  const g = gatesFor(detail, s);
  const reviewers = g.stages[0].participants.map((p) => agents.find((a) => a.id === p.agentId)?.name).join("+");
  if (DRY) {
    console.log(`[dry] ${detail.identifier} score=${s} ${g.band.padEnd(6)} reviewers=${reviewers} approvers=${g.stages[1] ? "CEO" : "-"}  :: ${detail.title.slice(0, 45)}`);
    continue;
  }
  await api("PATCH", `/api/issues/${issue.id}`, {
    executionPolicy: { mode: "normal", commentRequired: true, stages: g.stages, monitor: null, maxReviewRounds: null },
  });
  assigned++;
  console.log(`assigned ${detail.identifier} score=${s} ${g.band} reviewers=${reviewers}${g.stages[1] ? " +approval(CEO)" : ""}`);
}
if (targets.length && unreadable === targets.length) {
  console.error("all targets unreadable — the per-issue detail route or its auth changed; fix before trusting skips");
  process.exitCode = 1;
}
console.log(`\n${DRY ? "[dry] " : ""}targets=${targets.length} assigned=${assigned} skipped(existing gates)=${skipped} unreadable=${unreadable}`);
