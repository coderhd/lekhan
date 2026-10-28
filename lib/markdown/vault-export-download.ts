import { downloadBlob } from '@/lib/export-utils'
import { buildVaultFiles, type FidelityExportReport, type VaultPage } from '@/lib/markdown/vault-export'
import { buildZipBytes } from '@/lib/zip-write'

/**
 * Browser edge of the vault export: build the vault files, zip them in memory,
 * and download. The caller owns supplying each Page's `doc` (see spec §5.5 for
 * the content-source decision); this function only owns the pure → download
 * step, so it stays a thin, testable seam.
 */
export function downloadVaultZip(pages: VaultPage[], filename = 'lekhan-vault.zip'): FidelityExportReport {
	const { files, report } = buildVaultFiles(pages)
	downloadBlob(new Blob([buildZipBytes(files) as BlobPart], { type: 'application/zip' }), filename)
	return report
}
