const fs = require('fs')
const path = require('path')
const logDir = path.join(__dirname, '../wal_logs')

if (!fs.existsSync(logDir)) {
	fs.mkdirSync(logDir, { recursive: true })
}

function appendUpdate (documentId, binary) {
	const logPath = path.join(logDir, `${documentId}.bin`)
	const lengthBuffer = Buffer.alloc(4)
	lengthBuffer.writeUInt32BE(binary.length, 0)
	fs.appendFileSync(logPath, Buffer.concat([lengthBuffer, binary]))
}

function getPendingUpdates (documentId) {
	const logPath = path.join(logDir, `${documentId}.bin`)
	if (!fs.existsSync(logPath)) {
		return []
	}
	const data = fs.readFileSync(logPath)
	const updates = []
	let offset = 0
	while (offset < data.length) {
		if (offset + 4 > data.length) {
			break
		}
		const length = data.readUInt32BE(offset)
		offset += 4
		if (offset + length > data.length) {
			break
		}
		updates.push(data.subarray(offset, offset + length))
		offset += length
	}
	return updates
}

function clearUpdates (documentId) {
	const logPath = path.join(logDir, `${documentId}.bin`)
	if (fs.existsSync(logPath)) {
		fs.unlinkSync(logPath)
	}
}

module.exports = { appendUpdate, getPendingUpdates, clearUpdates }
