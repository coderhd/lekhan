import { createClient } from '@supabase/supabase-js'
import { isEncryptedSnapshot, encryptSnapshot } from '../lib/server-crypto'

/**
 * Migration / Backfill script for ADR 0001 (Snapshot encryption at rest).
 *
 * Scans the Supabase Storage 'documents' bucket, checks if snapshots are encrypted,
 * and encrypts unencrypted snapshots in place.
 *
 * Usage:
 *   npx tsx scripts/encrypt-at-rest-backfill.ts [--dry-run]
 */

async function runBackfill() {
	const isDryRun = process.argv.includes('--dry-run')
	console.log(`[Backfill] Starting encryption-at-rest backfill (dry-run: ${isDryRun})...`)

	const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
	const serviceRoleKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY

	if (!supabaseUrl || !serviceRoleKey) {
		console.error('[Backfill Error] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY.')
		process.exit(1)
	}

	const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
		auth: { persistSession: false, autoRefreshToken: false },
	})

	const { data: topLevelItems, error: listError } = await supabaseAdmin.storage
		.from('documents')
		.list('', { limit: 1000 })

	if (listError) {
		console.error('[Backfill Error] Failed to list documents bucket:', listError)
		process.exit(1)
	}

	let totalScanned = 0
	let totalEncrypted = 0
	let totalSkipped = 0
	let totalFailed = 0

	const processFile = async (filePath: string) => {
		totalScanned++
		try {
			const { data, error } = await supabaseAdmin.storage.from('documents').download(filePath)
			if (error || !data) {
				console.error(`[Backfill Error] Download failed for ${filePath}:`, error)
				totalFailed++
				return
			}

			const buffer = Buffer.from(await data.arrayBuffer())
			if (isEncryptedSnapshot(buffer)) {
				console.log(`[Backfill] ${filePath} is already encrypted. Skipping.`)
				totalSkipped++
				return
			}

			console.log(`[Backfill] Encrypting ${filePath} (${buffer.length} bytes)...`)
			if (!isDryRun) {
				const encrypted = encryptSnapshot(buffer)
				const { error: uploadError } = await supabaseAdmin.storage
					.from('documents')
					.upload(filePath, encrypted, {
						contentType: 'application/octet-stream',
						upsert: true,
					})

				if (uploadError) {
					console.error(`[Backfill Error] Upload failed for ${filePath}:`, uploadError)
					totalFailed++
					return
				}
			}
			totalEncrypted++
		} catch (err) {
			console.error(`[Backfill Error] Unexpected error on ${filePath}:`, err)
			totalFailed++
		}
	}

	for (const item of topLevelItems || []) {
		if (item.id && !item.name.endsWith('.bin')) {
			// Item is a folder (e.g. documentId or pageId)
			const folderName = item.name
			const { data: subItems } = await supabaseAdmin.storage
				.from('documents')
				.list(folderName, { limit: 100 })

			for (const sub of subItems || []) {
				if (sub.name === 'main_state.bin') {
					await processFile(`${folderName}/main_state.bin`)
				} else if (sub.name === 'versions') {
					// Check versions folder
					const { data: versionFiles } = await supabaseAdmin.storage
						.from('documents')
						.list(`${folderName}/versions`, { limit: 500 })

					for (const vf of versionFiles || []) {
						if (vf.name.endsWith('.bin')) {
							await processFile(`${folderName}/versions/${vf.name}`)
						}
					}
				}
			}
		} else if (item.name.endsWith('.bin')) {
			await processFile(item.name)
		}
	}

	console.log(`\n================ Backfill Summary ================`)
	console.log(`Total scanned:   ${totalScanned}`)
	console.log(`Newly encrypted: ${totalEncrypted}`)
	console.log(`Already secure:  ${totalSkipped}`)
	console.log(`Failed:          ${totalFailed}`)
	console.log(`==================================================\n`)
}

if (require.main === module) {
	runBackfill().catch(err => {
		console.error('Fatal backfill error:', err)
		process.exit(1)
	})
}
