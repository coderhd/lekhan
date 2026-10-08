#!/usr/bin/env node
/**
 * Velocity dashboard for the Paperclip org.
 *
 * Reads issues + labels from the Paperclip API, groups them by `sprint:<YYYY-Www>`
 * label, and writes a self-contained HTML dashboard (committed vs done points,
 * rollover count, velocity trend).
 *
 *   node scripts/paperclip/velocity-report.mjs [--out <path>] [--open]
 *
 * Config via env or ~/.paperclip-onboarding/paperclip.env:
 *   PAPERCLIP_API_URL, PAPERCLIP_API_KEY, PAPERCLIP_COMPANY_ID
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
const args = process.argv.slice(2);
const OUT = args.includes("--out") ? args[args.indexOf("--out") + 1] : "docs/velocity/index.html";

if (!KEY) { console.error("PAPERCLIP_API_KEY required"); process.exit(1); }

const j = async (p) => (await fetch(`${API}${p}`, { headers: { Authorization: `Bearer ${KEY}` } })).json();
const labels = await j(`/api/companies/${COMPANY}/labels`);
const labelName = new Map(labels.map((l) => [l.id, l.name]));
const issues = await j(`/api/companies/${COMPANY}/issues`);

const sprints = new Map(); // sprint -> { committed, done, rollover, issues:[] }
for (const i of issues) {
  const names = (i.labelIds ?? []).map((id) => labelName.get(id)).filter(Boolean);
  const sprint = names.find((n) => /^sprint:/.test(n));
  if (!sprint) continue;
  const est = names.find((n) => /^est:/.test(n));
  const points = est ? Number(est.split(":")[1]) : 0;
  const rollover = names.includes("rollover");
  if (!sprints.has(sprint)) sprints.set(sprint, { committed: 0, done: 0, rollover: 0, issues: [] });
  const s = sprints.get(sprint);
  s.committed += points;
  if (i.status === "done") s.done += points;
  if (rollover) s.rollover += 1;
  s.issues.push({ id: i.identifier, title: i.title, status: i.status, points, rollover });
}
const ordered = [...sprints.entries()].sort((a, b) => a[0].localeCompare(b[0]));
const rows = ordered.map(([sprint, s]) => ({ sprint, ...s }));
const maxPoints = Math.max(1, ...rows.map((r) => r.committed));
const velocity = rows.map((r) => r.done);
const avgVelocity = velocity.length ? Math.round(velocity.reduce((a, b) => a + b, 0) / velocity.length) : 0;

const bar = (v) => Math.round((v / maxPoints) * 100);
const rowsHtml = rows.map((r) => `
  <tr>
    <td class="mono">${r.sprint}</td>
    <td><div class="bar committed" style="width:${bar(r.committed)}%"><span>${r.committed}</span></div></td>
    <td><div class="bar done" style="width:${bar(r.done)}%"><span>${r.done}</span></div></td>
    <td class="mono">${r.rollover}</td>
    <td class="mono">${r.committed ? Math.round((r.done / r.committed) * 100) : 0}%</td>
  </tr>`).join("");

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Lekhan shipping velocity</title>
<style>
 :root{--bg:#0b0e14;--panel:#141a24;--ink:#e6edf3;--muted:#8b98a9;--acc:#4f9cf9;--ok:#3fb950;--warn:#d29922}
 *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
 .wrap{max-width:960px;margin:0 auto;padding:40px 24px}
 h1{font-size:26px;margin:0 0 4px} .sub{color:var(--muted);margin:0 0 28px}
 .cards{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:28px}
 .card{background:var(--panel);border:1px solid #202836;border-radius:12px;padding:16px}
 .card .k{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.06em}
 .card .v{font-size:30px;font-weight:700;margin-top:6px}
 table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid #202836;border-radius:12px;overflow:hidden}
 th,td{padding:10px 14px;text-align:left;border-bottom:1px solid #202836}
 th{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.06em;font-weight:600}
 .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
 .bar{height:20px;border-radius:5px;display:flex;align-items:center;min-width:24px}
 .bar span{padding:0 6px;font-size:12px;color:#0b0e14;font-weight:600}
 .committed{background:#2b3a52} .done{background:var(--ok)}
 .empty{color:var(--muted);padding:24px;text-align:center}
 footer{color:var(--muted);margin-top:20px;font-size:12px}
</style></head><body><div class="wrap">
 <h1>Lekhan shipping velocity</h1>
 <p class="sub">Paperclip org · committed vs done points per sprint (from <span class="mono">sprint:*</span> + <span class="mono">est:*</span> labels) · generated ${new Date().toISOString()}</p>
 <div class="cards">
   <div class="card"><div class="k">Sprints tracked</div><div class="v">${rows.length}</div></div>
   <div class="card"><div class="k">Avg velocity (pts)</div><div class="v">${avgVelocity}</div></div>
   <div class="card"><div class="k">Issues with sprint label</div><div class="v">${rows.reduce((a, r) => a + r.issues.length, 0)}</div></div>
 </div>
 ${rows.length ? `<table><thead><tr><th>Sprint</th><th>Committed</th><th>Done</th><th>Rollover</th><th>Completion</th></tr></thead><tbody>${rowsHtml}</tbody></table>` : `<div class="empty">No <span class="mono">sprint:*</span>-labelled issues yet. The dashboard fills in as sprints close.</div>`}
 <footer>Generated by <span class="mono">scripts/paperclip/velocity-report.mjs</span>. Velocity = committed points of issues that reached <span class="mono">done</span>.</footer>
</div></body></html>`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);
console.log(`wrote ${OUT} (${rows.length} sprints, avg velocity ${avgVelocity})`);
if (args.includes("--open")) { const { execFileSync } = await import("node:child_process"); try { execFileSync("open", [OUT]); } catch { /* ignore */ } }
