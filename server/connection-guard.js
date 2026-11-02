/**
 * Frame-level write guard for viewer and read-only collab connections
 * (SIL-214). Export gap-syncs connect with `readOnly=1`; they must be able to
 * receive state (and send sync step 1, which carries their state vector) but
 * must never apply an update to the room.
 *
 * Kept in its own module so the admission rule is unit-testable without
 * booting the full server and its auth/Supabase dependencies.
 */

const MESSAGE_SYNC = 0
const SYNC_STEP1 = 0
const SYNC_STEP2 = 1
const SYNC_UPDATE = 2

/**
 * @param {{ isViewer?: boolean, isReadOnly?: boolean }} conn
 * @param {Buffer | Uint8Array | null | undefined} data
 * @param {boolean | undefined} isBinary
 * @returns {boolean} true when the frame is a write that must be dropped.
 */
function isBlockedWriteFrame(conn, data, isBinary) {
	if (!conn.isViewer && !conn.isReadOnly) return false
	if (!isBinary || !data || data.length < 2) return false
	if (data[0] !== MESSAGE_SYNC) return false
	return data[1] === SYNC_STEP2 || data[1] === SYNC_UPDATE
}

module.exports = {
	MESSAGE_SYNC,
	SYNC_STEP1,
	SYNC_STEP2,
	SYNC_UPDATE,
	isBlockedWriteFrame,
}
