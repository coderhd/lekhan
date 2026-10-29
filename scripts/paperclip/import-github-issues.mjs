#!/usr/bin/env node
/**
 * Import GitHub issues into Paperclip as tasks (one-way, idempotent).
 *
 * GitHub stays a read source; Paperclip becomes the home. Re-running reconciles:
 * every imported issue carries a durable marker `source:github/<repo>#<n>` in its
 * description, and any issue whose marker already exists in Paperclip is skipped.
 *
 * Usage:
 *   node scripts/paperclip/import-github-issues.mjs [--dry-run] [--state open|closed|all]
 *
 * Config (env or ~/.paperclip-onboarding/paperclip.env):
 *   PAPERCLIP_API_URL, PAPERCLIP_API_KEY
 *   PAPERCLIP_COMPANY_ID, PAPERCLIP_PROJECT_ID
 *   GITHUB_REPO (default: coderhd/lekhan), GH_BIN (default: gh)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

// ---------- config ----------
function loadEnvFile() {
  const p = path.join(os.homedir(), ".paperclip-onboarding", "paperclip.env");
  if (!fs.existsSync(p)) return {};
  const out = {};
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.replace(/^export\s+/, "").match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
const fileEnv = loadEnvFile();
const env = (k, d) => process.env[k] ?? fileEnv[k] ?? d;

const API = env("PAPERCLIP_API_URL", "http://127.0.0.1:3100");
const KEY = env("PAPERCLIP_API_KEY");
const COMPANY = env("PAPERCLIP_COMPANY_ID", "b044e7dc-7bb3-46b8-a47f-596a3c75d879");
const PROJECT = env("PAPERCLIP_PROJECT_ID", "9b5e4978-d493-455e-ae41-2885cff9dc8b");
const REPO = env("GITHUB_REPO", "coderhd/lekhan");
const GH = env("GH_BIN", "gh"); // resolve from PATH; override with GH_BIN if needed

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const STATE = args.includes("--state") ? args[args.indexOf("--state") + 1] : "open";
if (!["open", "closed", "all"].includes(STATE)) {
  console.error(`--state must be open, closed, or all (got: ${STATE})`);
  process.exit(1);
}

if (!KEY) { console.error("PAPERCLIP_API_KEY is required"); process.exit(1); }

// ---------- helpers ----------
async function api(method, urlPath, body, { board = false } = {}) {
  const res = await fetch(`${API}${urlPath}`, {
    method,
    headers: { ...(board ? {} : { Authorization: `Bearer ${KEY}` }), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON error body */ }
  if (!res.ok) throw new Error(`${method} ${urlPath} -> ${res.status} ${json?.error ?? text.slice(0, 200)}`);
  return json;
}

function gh(argsArr) {
  return JSON.parse(execFileSync(GH, argsArr, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MARKER_RE = new RegExp(`source:github/${esc(REPO)}#(\\d+)`);
const markerFor = (n) => `source:github/${REPO}#${n}`;
const markerNumber = (issue) => {
  const m = (issue.description ?? "").match(MARKER_RE);
  return m ? Number(m[1]) : null;
};

const STATUS_MAP = [
  [/^in[ -]?review$/i, "in_review"],
  [/^in[ -]?progress$/i, "in_progress"],
  [/^blocked$/i, "blocked"],
  [/^ready-for-agent$/i, "todo"],
  [/^needs-spec$/i, "backlog"],
];
function statusFor(issue, labels) {
  if (issue.state === "CLOSED") return "done";
  for (const [re, s] of STATUS_MAP) if (labels.some((l) => re.test(l))) return s;
  return "backlog";
}
function priorityFor(labels) {
  if (labels.some((l) => /^(p0|critical|h0)$/i.test(l))) return "high";
  if (labels.some((l) => /^(p1|h1)$/i.test(l))) return "medium";
  return "medium";
}
function normalizeColor(color) {
  if (typeof color !== "string") return "#cccccc";
  const hex = color.replace(/^#/, "");
  return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex}` : "#cccccc";
}
function blockersIn(body) {
  if (!body) return [];
  const out = new Set();
  const re = /(?:blocked by|depends on|blocker[s]?:?)[^\n]*/gi;
  for (const m of body.match(re) ?? []) for (const n of m.match(/#(\d+)/g) ?? []) out.add(Number(n.slice(1)));
  return [...out];
}
// Native GitHub blocker edges (canonical); returns null when unavailable so the
// caller falls back to parsing "Blocked by #n" lines from the body.
function nativeBlockers(number) {
  try {
    const rows = gh(["api", `repos/${REPO}/issues/${number}/dependencies/blocked_by`, "--paginate"]);
    if (!Array.isArray(rows)) return null;
    return rows.map((r) => r.number).filter((n) => Number.isInteger(n));
  } catch {
    return null;
  }
}

// ---------- fetch ----------
console.log(`Fetching GitHub issues from ${REPO} (state=${STATE}) ...`);
const ghIssues = gh(["issue", "list", "--repo", REPO, "--state", STATE, "--limit", "500",
  "--json", "number,title,body,labels,milestone,url,state,createdAt"]);
console.log(`  ${ghIssues.length} GitHub issues`);

const pcIssues = await api("GET", `/api/companies/${COMPANY}/issues`);
const existing = new Set();
for (const it of pcIssues) { const n = markerNumber(it); if (n != null) existing.add(n); }
console.log(`  ${existing.size} already in Paperclip`);

// ensure labels exist
const pcLabels = await api("GET", `/api/companies/${COMPANY}/labels`);
const labelId = new Map(pcLabels.map((l) => [l.name.toLowerCase(), l.id]));
const usedLabels = new Map();
for (const it of ghIssues) for (const l of it.labels) usedLabels.set(l.name, l.color ?? "#cccccc");
for (const [name, color] of usedLabels) {
  if (labelId.has(name.toLowerCase())) continue;
  if (DRY) { console.log(`  [dry] would create label ${name}`); continue; }
  const created = await api("POST", `/api/companies/${COMPANY}/labels`, { name, color: normalizeColor(color) });
  labelId.set(name.toLowerCase(), created.id);
}

// ---------- import ----------
const created = [];
for (const it of ghIssues) {
  const labels = it.labels.map((l) => l.name);
  const marker = markerFor(it.number);
  if (existing.has(it.number)) { continue; }
  const desc = [
    `<!-- ${marker} -->`,
    `**Source:** ${it.url}`,
    it.milestone ? `**Milestone:** ${it.milestone.title}` : null,
    "",
    it.body ?? "",
  ].filter((x) => x !== null).join("\n");
  const payload = {
    title: `#${it.number} ${it.title}`,
    description: desc,
    status: statusFor(it, labels),
    priority: priorityFor(labels),
    projectId: PROJECT,
    labelIds: labels.map((l) => labelId.get(l.toLowerCase())).filter(Boolean),
    idempotencyKey: `gh-import:${REPO}#${it.number}`,
  };
  if (DRY) { console.log(`  [dry] create #${it.number} (${it.state}) ${it.title.slice(0, 60)}`); continue; }
  const issue = await api("POST", `/api/companies/${COMPANY}/issues`, payload);
  created.push({ gh: it.number, pc: issue.id, title: it.title });
  console.log(`  created #${it.number} (${it.state}) -> ${issue.id}`);
}

// ---------- blockers (second pass) ----------
if (!DRY) {
  const all = await api("GET", `/api/companies/${COMPANY}/issues`);
  const byGh = new Map();
  for (const it of all) { const n = markerNumber(it); if (n != null) byGh.set(n, it); }
  let linked = 0;
  for (const it of ghIssues) {
    const native = nativeBlockers(it.number);
    const deps = native ?? blockersIn(it.body);
    const self = byGh.get(it.number);
    if (!self || deps.length === 0) continue;
    const imported = deps.map((n) => byGh.get(n)?.id).filter((id) => id && id !== self.id);
    if (imported.length === 0) continue;
    // `blockedByIssueIds` REPLACES the set — union with any existing (operator-managed) edges.
    const existingBlockedBy = (self.blockedByIssueIds ?? []).filter((id) => id !== self.id);
    const merged = [...new Set([...existingBlockedBy, ...imported])];
    try { await api("PATCH", `/api/issues/${self.id}`, { blockedByIssueIds: merged }); linked++; }
    catch {
      // Agents need a run to attribute cross-issue writes; fall back to board (local_trusted).
      try { await api("PATCH", `/api/issues/${self.id}`, { blockedByIssueIds: merged }, { board: true }); linked++; }
      catch (e2) { console.log(`  blocker link failed for #${it.number}: ${String(e2).slice(0, 120)}`); }
    }
  }
  console.log(`  ${linked} issues got blocker links`);
}

console.log(`\nDone. created=${created.length}, skipped=${ghIssues.length - created.length}, total gh=${ghIssues.length}`);
