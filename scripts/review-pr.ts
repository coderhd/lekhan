import fs from 'node:fs'
import path from 'node:path'
import { execSync, execFileSync } from 'node:child_process'

/**
 * Independent Clean-Room AI PR Reviewer for Lekhan.
 *
 * Uses OpenRouter API (GLM 5.2 / openrouter/free) to perform an adversarial,
 * domain-aware peer code review without external SaaS rate limits.
 *
 * Usage:
 *   npx tsx scripts/review-pr.ts <pr-number> [--post] [--model <model-id>]
 *   npx tsx scripts/review-pr.ts --diff [--model <model-id>]
 */

function loadEnv(): Record<string, string> {
	const env: Record<string, string> = {}
	const envFiles = ['.env.local', '.env']

	for (const file of envFiles) {
		const filePath = path.resolve(process.cwd(), file)
		if (fs.existsSync(filePath)) {
			const lines = fs.readFileSync(filePath, 'utf8').split('\n')
			for (const line of lines) {
				const trimmed = line.trim()
				if (!trimmed || trimmed.startsWith('#')) continue
				const eqIndex = trimmed.indexOf('=')
				if (eqIndex > 0) {
					const key = trimmed.slice(0, eqIndex).trim()
					let value = trimmed.slice(eqIndex + 1).trim()
					if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
						value = value.slice(1, -1)
					}
					if (!env[key]) {
						env[key] = value
					}
				}
			}
		}
	}
	for (const [k, v] of Object.entries(process.env)) {
		if (typeof v === 'string') {
			env[k] = v
		}
	}
	return env
}

function getGhPath(): string {
	const possiblePaths = ['/opt/homebrew/bin/gh', '/usr/local/bin/gh', 'gh']
	for (const p of possiblePaths) {
		try {
			execSync(`${p} --version`, { stdio: 'ignore' })
			return p
		} catch {
			// continue
		}
	}
	return 'gh'
}

function getPRDetails(prNumber: string, gh: string) {
	if (!/^\d+$/.test(prNumber)) {
		console.error(`[Error] Invalid pull request number: "${prNumber}". Expected numeric ID.`)
		process.exit(1)
	}

	try {
		const metaJson = execFileSync(
			gh,
			['pr', 'view', prNumber, '--json', 'number,title,body,baseRefName,headRefName,url'],
			{ encoding: 'utf8' }
		)
		const diff = execFileSync(gh, ['pr', 'diff', prNumber], {
			encoding: 'utf8',
			maxBuffer: 10 * 1024 * 1024,
		})
		const meta = JSON.parse(metaJson)
		return { ...meta, diff }
	} catch (err) {
		console.error(`Failed to fetch PR #${prNumber}:`, err)
		process.exit(1)
	}
}

function getLocalDiff(): { title: string; body: string; diff: string; number: string } {
	try {
		const diff = execSync('git diff origin/main...HEAD', { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
		const log = execSync('git log -n 1 --pretty=format:"%s%n%n%b"', { encoding: 'utf8' })
		return {
			number: 'LOCAL',
			title: 'Local Branch Diff',
			body: log,
			diff,
		}
	} catch (err) {
		console.error('Failed to get local git diff:', err)
		process.exit(1)
	}
}

function getDomainContext(): string {
	const root = process.cwd()
	let context = ''

	const files = [
		'CONTEXT.md',
		'AGENTS.md',
		'docs/adr/0001-encryption-at-rest-by-default-e2e-as-plus.md',
		'docs/adr/0004-server-hub-crdt-sync-topology.md',
	]

	for (const rel of files) {
		const abs = path.resolve(root, rel)
		if (fs.existsSync(abs)) {
			const content = fs.readFileSync(abs, 'utf8')
			context += `\n\n--- [DOMAIN SPEC: ${rel}] ---\n${content}\n`
		}
	}

	return context
}

async function callOpenRouter(
	apiKey: string,
	model: string,
	prompt: string,
	systemPrompt: string
): Promise<string> {
	const modelsToTry = [
		model,
		'z-ai/glm-5.2:free',
		'meta-llama/llama-3.3-70b-instruct:free',
		'google/gemini-2.0-flash-exp:free',
		'nvidia/nemotron-3-super-120b-a12b:free',
		'nvidia/nemotron-3-ultra-550b-a55b:free',
		'deepseek/deepseek-r1:free',
		'dots-studio/dots-3-note-preview:free',
		'openrouter/free',
	].filter((m, i, arr) => m && arr.indexOf(m) === i)

	let lastError: unknown = null

	for (const currentModel of modelsToTry) {
		try {
			console.log(`[Reviewer] Querying OpenRouter model: ${currentModel}...`)
			const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${apiKey}`,
					'Content-Type': 'application/json',
					'HTTP-Referer': 'https://github.com/coderhd/lekhan',
					'X-Title': 'Lekhan Clean-Room Reviewer',
				},
				signal: AbortSignal.timeout(60000),
				body: JSON.stringify({
					model: currentModel,
					messages: [
						{ role: 'system', content: systemPrompt },
						{ role: 'user', content: prompt },
					],
					temperature: 0.1,
					max_tokens: 6000,
				}),
			})

			const data = await response.json()

			if (response.status === 200) {
				const choice = data.choices?.[0]
				const finishReason = choice?.finish_reason || choice?.native_finish_reason
				let content = choice?.message?.content
				if (!content && choice?.message?.reasoning) {
					content = choice.message.reasoning
				}

				const isNormalCompletion =
					!finishReason || finishReason === 'stop' || finishReason === 'end_turn' || (finishReason === 'length' && (content?.trim()?.length || 0) > 800)

				if (isNormalCompletion && content && content.trim().length > 0) {
					return content.trim()
				} else {
					console.warn(
						`[Reviewer] Model ${currentModel} returned finish_reason: "${finishReason}". Falling back to next model...`
					)
					lastError = new Error(`Incomplete response with finish_reason: ${finishReason}`)
					continue
				}
			}

			if (response.status === 429 || response.status === 403 || response.status === 404) {
				console.warn(`[Reviewer] Model ${currentModel} returned status ${response.status}. Falling back to next model...`)
				lastError = new Error(`Model ${currentModel} returned status ${response.status}: ${data.error?.message || 'Error'}`)
				continue
			}

			throw new Error(`OpenRouter Error (${response.status}): ${JSON.stringify(data)}`)
		} catch (err) {
			console.warn(`[Reviewer] Failed with model ${currentModel}:`, err instanceof Error ? err.message : String(err))
			lastError = err
		}
	}

	throw lastError || new Error('All OpenRouter review model attempts failed.')
}

async function main() {
	const args = process.argv.slice(2)
	const env = loadEnv()
	const apiKey = env.OPENROUTER_API_KEY

	if (!apiKey) {
		console.error('[Error] Missing OPENROUTER_API_KEY in .env / .env.local / process.env')
		process.exit(1)
	}

	const gh = getGhPath()
	let prNumber: string | null = null
	let customModel = env.OPENROUTER_MODEL || 'z-ai/glm-5.2:free'
	let shouldPostComment = false

	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--post' || args[i] === '--comment') {
			shouldPostComment = true
		} else if (args[i] === '--model' && args[i + 1]) {
			customModel = args[++i]
		} else if (!args[i].startsWith('--')) {
			prNumber = args[i]
		}
	}

	console.log(`[Reviewer] Initializing Clean-Room Review Pipeline...`)

	const prData = prNumber ? getPRDetails(prNumber, gh) : getLocalDiff()

	if (!prData.diff || prData.diff.trim().length === 0) {
		console.log('[Reviewer] No git diff found. Nothing to review.')
		return
	}

	console.log(`[Reviewer] Reviewing: "${prData.title}" (${prData.diff.split('\n').length} diff lines)`)

	const domainContext = getDomainContext()

	const systemPrompt = `You are a Senior Principal Security & Distributed Systems Reviewer for Lekhan (a local-first collaborative note-taking and knowledge graph application).
You are performing a clean-room, adversarial peer code review.

Your Objectives:
1. Identify logical bugs, concurrency race conditions, memory leaks, and state corruption.
2. Verify ADR 0001 compliance (Snapshot encryption at rest with AES-256-GCM, LK_ENC_V1 header, fallback key rotation, no plaintext in Supabase Storage).
3. Verify ADR 0004 compliance (Server-hub CRDT sync topology, non-destructive additive merges).
4. Verify privacy boundaries (no note titles, plaintext bodies, or markdown leaked in analytics payloads).
5. Verify API route safety (payload size limits, authentication/RLS checks, rollback of DB inserts on storage failure).

Formatting Rules:
- Be direct, objective, and constructive. No performative cheerleading.
- Categorize findings by severity:
  - 🚨 [CRITICAL]: Security holes, data loss, irreversible state corruption, severe crash.
  - ⚠️ [HIGH]: Logic bugs, unhandled errors, sync desynchronization, memory leaks.
  - 💡 [MEDIUM]: Performance edge cases, missing defensive checks, minor API inconsistency.
  - 🔍 [LOW / NIT]: Code style, typing improvements, minor refactor suggestion.
- For each finding:
  - File path and line reference.
  - Exact failure scenario / counter-example explaining why it fails.
  - Recommended fix (with Markdown diff block if applicable).
- If no critical or high issues are found, state clearly: "VERDICT: APPROVE (No blocking issues detected)" and summarize verified invariants.`

	const userPrompt = `Please review the following Pull Request:

## Title: ${prData.title}
## Description:
${prData.body || 'No description provided.'}

${domainContext}

## Pull Request Diff:
\`\`\`diff
${prData.diff}
\`\`\`

Provide your structured code review now:`

	const reviewOutput = await callOpenRouter(apiKey, customModel, userPrompt, systemPrompt)

	// Clean up any internal reasoning/thinking tags from reasoning models
	let cleanOutput = reviewOutput
	if (cleanOutput.includes('</think>')) {
		cleanOutput = cleanOutput.split('</think>').pop()!.trim()
	}

	console.log('\n' + '='.repeat(80))
	console.log(`REVIEW RESULT FOR: ${prData.title}`)
	console.log('='.repeat(80) + '\n')
	console.log(cleanOutput)
	console.log('\n' + '='.repeat(80))

	// Save review to file
	const reviewsDir = path.resolve(process.cwd(), 'docs/reviews')
	if (!fs.existsSync(reviewsDir)) {
		fs.mkdirSync(reviewsDir, { recursive: true })
	}
	const reviewFile = path.resolve(reviewsDir, `pr-${prData.number || 'local'}-review.md`)
	const formattedReview = `### 🤖 Lekhan Independent Clean-Room Review (${customModel})\n\n${cleanOutput}\n`
	fs.writeFileSync(reviewFile, formattedReview, 'utf8')
	console.log(`[Reviewer] Review saved locally to: ${reviewFile}`)

	if (shouldPostComment && prNumber) {
		console.log(`[Reviewer] Posting review to GitHub PR #${prNumber}...`)
		try {
			execFileSync(gh, ['pr', 'comment', prNumber, '--body-file', reviewFile], {
				encoding: 'utf8',
				stdio: 'inherit',
			})
			console.log(`[Reviewer] Successfully commented on PR #${prNumber}!`)
		} catch (err) {
			console.error(`[Reviewer] Failed to post comment on PR #${prNumber}:`, err)
		}
	}
}

main().catch(err => {
	console.error('[Fatal Error]', err)
	process.exit(1)
})
