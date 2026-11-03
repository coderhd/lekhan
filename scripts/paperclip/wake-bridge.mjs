#!/usr/bin/env node
/**
 * Paperclip wake bridge — keeps agents working without burning quota.
 *
 * Paperclip wakes an agent natively when a task is ASSIGNED or when an issue
 * transitions to an actionable status. What it does not do is re-wake an agent
 * that finished a run while still holding actionable assigned work ("idle with
 * work"), or an agent whose blockers cleared without a status transition.
 *
 * This bridge closes exactly those gaps:
 *   - actionable issue (todo | in_progress) + assignee + assignee has NO live run
 *     + not woken for this issue recently  →  wake the assignee with issue context.
 *   - issue with blocker edges that just cleared → wake (safety net for the case
 *     where the status transition did not fire a run).
 *
 * Polling is local HTTP only — it costs nothing unless it actually wakes someone.
 *
 * Usage:
 *   node wake-bridge.mjs [--once] [--dry-run]
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dir = path.join(os.homedir(), '.paperclip-onboarding')
const statePath = path.join(dir, 'wake-bridge-state.json')
const logPath = path.join(dir, 'wake-bridge.log')

const ONCE = process.argv.includes('--once')
const DRY = process.argv.includes('--dry-run')
const MAX_WAKES_PER_TICK = 6

function loadEnv() {
	const out = {}
	const p = path.join(dir, 'paperclip.env')
	if (!fs.existsSync(p)) return out
	for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
		const m = line.replace(/^export\s+/, '').match(/^([A-Z0-9_]+)=(.*)$/)
		if (m) out[m[1]] = m[2]
	}
	return out
}

const env = loadEnv()
/** Same precedence as the sibling Paperclip scripts: process env, then env file, then default. */
const envValue = (k, fallback) => process.env[k] ?? env[k] ?? fallback

const API = envValue('PAPERCLIP_API_URL')
const KEY = envValue('PAPERCLIP_API_KEY')
const COMPANY = envValue('PAPERCLIP_COMPANY_ID', 'b044e7dc-7bb3-46b8-a47f-596a3c75d879')

// Tuning is read from the process env OR the onboarding env file, so a LaunchAgent
// install does not force hand-editing a plist.
const POLL_MS = Number(envValue('WAKE_BRIDGE_POLL_MS', 15_000))
const COOLDOWN_MS = Number(envValue('WAKE_BRIDGE_COOLDOWN_MS', 10 * 60_000))

if (!API || !KEY) {
	process.stderr.write('wake-bridge: PAPERCLIP_API_URL and PAPERCLIP_API_KEY must be set (env or ~/.paperclip-onboarding/paperclip.env)\n')
	process.exit(1)
}

function log(line) {
	const entry = `${new Date().toISOString()} ${line}\n`
	if (!DRY) fs.appendFileSync(logPath, entry)
	process.stdout.write(entry)
}

function loadState() {
	try {
		return JSON.parse(fs.readFileSync(statePath, 'utf8'))
	} catch {
		return { wakes: {}, blockedEdges: {} }
	}
}

function saveState(state) {
	if (DRY) return
	fs.writeFileSync(statePath, JSON.stringify(state), { mode: 0o600 })
}

async function get(pathname) {
	const res = await fetch(`${API}${pathname}`, { headers: { Authorization: `Bearer ${KEY}` } })
	if (!res.ok) throw new Error(`GET ${pathname} -> ${res.status}`)
	return res.json()
}

/** Board-mode write: agent keys are capped for cross-issue wakes. */
async function patchBoard(pathname, body) {
	const res = await fetch(`${API}${pathname}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	})
	return { status: res.status, text: await res.text() }
}

async function post(pathname, body) {
	const res = await fetch(`${API}${pathname}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	})
	return { status: res.status, text: await res.text() }
}

async function tick() {
	const state = loadState()
	const now = Date.now()

	const [issuesRaw, agentsRaw, liveRaw] = await Promise.all([
		get(`/api/companies/${COMPANY}/issues`),
		get(`/api/companies/${COMPANY}/agents`),
		get(`/api/companies/${COMPANY}/live-runs`),
	])

	const issues = Array.isArray(issuesRaw) ? issuesRaw : (issuesRaw.issues ?? [])
	const agents = Array.isArray(agentsRaw) ? agentsRaw : (agentsRaw.agents ?? [])
	const live = Array.isArray(liveRaw) ? liveRaw : (liveRaw.runs ?? [])

	const agentById = new Map(agents.map((a) => [a.id, a]))
	const busyAgents = new Set(live.map((r) => r.agentId).filter(Boolean))

	const candidates = []
	for (const issue of issues) {
		const status = issue.status
		const assignee = issue.assigneeAgentId
		if (!assignee) continue
		if (status !== 'todo' && status !== 'in_progress') continue

		const agent = agentById.get(assignee)
		if (!agent) continue
		if (agent.status === 'running' || busyAgents.has(assignee)) continue

		const key = `${assignee}:${issue.id}`
		const last = state.wakes[key] ?? 0
		if (now - last < COOLDOWN_MS) continue

		candidates.push({ issue, agent, key })
	}

	// Safety net: blocker edges that cleared without a status transition.
	const blocked = issues.filter((i) => i.status === 'blocked' && i.assigneeAgentId)
	for (const issue of blocked) {
		try {
			const detail = await get(`/api/issues/${issue.id}`)
			const edges = Array.isArray(detail.blockedBy) ? detail.blockedBy.length : 0
			const prev = state.blockedEdges[issue.id]
			state.blockedEdges[issue.id] = edges
			if (typeof prev === 'number' && prev > 0 && edges === 0) {
				const agent = agentById.get(issue.assigneeAgentId)
				const key = `${issue.assigneeAgentId}:${issue.id}`
				const last = state.wakes[key] ?? 0
				// Same cooldown as the actionable path: an agent already woken for
				// this issue must not be woken again by the edge-cleared safety net.
				if (agent && agent.status !== 'running' && !busyAgents.has(issue.assigneeAgentId) && now - last >= COOLDOWN_MS) {
					candidates.push({
						issue: { ...issue, status: 'blocked' },
						agent,
						key,
						reason: 'blockers-cleared',
					})
				}
			}
		} catch {
			/* detail read is best-effort */
		}
	}

	if (candidates.length === 0) {
		saveState(state)
		return 0
	}

	// Deterministic order; at most one wake per agent per tick.
	const seenAgents = new Set()
	const chosen = []
	for (const c of candidates.sort((a, b) => String(a.issue.identifier).localeCompare(String(b.issue.identifier)))) {
		if (seenAgents.has(c.agent.id)) continue
		seenAgents.add(c.agent.id)
		chosen.push(c)
		if (chosen.length >= MAX_WAKES_PER_TICK) break
	}

	let woke = 0
	for (const c of chosen) {
		const label = `${c.agent.name} <- ${c.issue.identifier} (${c.reason ?? c.issue.status})`
		if (DRY) {
			log(`[dry] would wake ${label}`)
			continue
		}
		// An agent stuck in `error` cannot accept work; recover it first.
		if (c.agent.status === 'error') {
			await patchBoard(`/api/agents/${c.agent.id}`, { status: 'idle' })
			log(`recovered ${c.agent.name} from error`)
		}
		const res = await post(`/api/agents/${c.agent.id}/wakeup`, {
			source: 'assignment',
			reason: `Wake bridge: ${c.issue.identifier} is actionable and assigned to you but you have no active run.`,
			payload: {
				issueId: c.issue.id,
				identifier: c.issue.identifier,
				status: c.issue.status,
				reason: c.reason ?? 'idle-with-work',
			},
			forceFreshSession: false,
		})
		if (res.status === 202 || res.status === 200) {
			state.wakes[c.key] = Date.now()
			woke += 1
			log(`woke ${label}`)
		} else {
			log(`wake failed ${label}: ${res.status} ${res.text.slice(0, 120)}`)
		}
	}

	// Prune wake history older than a day.
	for (const [k, ts] of Object.entries(state.wakes)) {
		if (now - ts > 24 * 60 * 60_000) delete state.wakes[k]
	}
	// Prune edge snapshots for closed issues.
	const openIds = new Set(issues.map((i) => i.id))
	for (const id of Object.keys(state.blockedEdges)) {
		if (!openIds.has(id)) delete state.blockedEdges[id]
	}

	saveState(state)
	return woke
}

async function main() {
	log(`wake-bridge start (poll=${POLL_MS}ms cooldown=${COOLDOWN_MS}ms once=${ONCE} dry=${DRY})`)
	if (ONCE) {
		const n = await tick()
		log(`once done (${n} wakes)`)
		return
	}
	while (true) {
		try {
			await tick()
		} catch (err) {
			log(`tick error: ${err instanceof Error ? err.message : String(err)}`)
		}
		await new Promise((r) => setTimeout(r, POLL_MS))
	}
}

main().catch((err) => {
	log(`fatal: ${err instanceof Error ? err.message : String(err)}`)
	process.exit(1)
})
