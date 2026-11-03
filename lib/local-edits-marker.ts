const PENDING_EDITS_KEY_PREFIX = 'lekhan:pending-local-edits:'

function pendingEditsKey (documentId: string): string {
	return `${PENDING_EDITS_KEY_PREFIX}${documentId}`
}

/**
 * Whether this device may still be holding edits that have not reached the
 * hub. Persisted so the honest "Local edits only" state survives a reload
 * while offline — the exact moment its reassurance matters most.
 */
export function hasPendingLocalEdits (documentId: string): boolean {
	if (typeof window === 'undefined') {
		return false
	}

	try {
		return window.localStorage.getItem(pendingEditsKey(documentId)) === '1'
	} catch {
		// Storage can be unavailable (private mode, quota). Reporting "no
		// pending edits" only understates the state; it never fabricates one.
		return false
	}
}

export function setPendingLocalEdits (documentId: string, pending: boolean): void {
	if (typeof window === 'undefined') {
		return
	}

	try {
		if (pending) {
			window.localStorage.setItem(pendingEditsKey(documentId), '1')
		} else {
			window.localStorage.removeItem(pendingEditsKey(documentId))
		}
	} catch {
		// Never let indicator bookkeeping throw during an edit.
	}
}
