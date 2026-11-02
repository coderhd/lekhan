import * as Y from 'yjs'

/**
 * Quick capture (epic #39, DN-T2).
 *
 * A capture is a timestamped bullet in a Page's "Inbox" section. The append
 * never writes page bodies through the server: it mutates the page's Yjs
 * document — the same `default` XmlFragment the live editor binds to over
 * y-websocket — so the change is an ordinary CRDT update and collaborators see
 * it immediately. The shape written here (heading/listItem/paragraph nodes
 * containing Y.XmlText) is exactly what `@tiptap/y-tiptap` produces for the
 * shared editor schema, so the live editor renders it without translation.
 *
 * See `docs/superpowers/specs/2026-11-02-h1-daily-notes-quick-capture-inbox-design.md`.
 */

export const CAPTURE_INBOX_TAG = 'inbox'
export const CAPTURE_INBOX_HEADING = 'Inbox'

/** The Tiptap Collaboration extension's default fragment field. */
export const CAPTURE_FRAGMENT_FIELD = 'default'

const INBOX_TAG_RE = /(?:^|\s)#inbox\b/i
const INBOX_SECTION_LEVEL = 2
// The sync hub runs on Render's free tier, which documents ~50s cold starts;
// `useEditorCollab` grants the same 60s grace before calling a connection dead.
const DEFAULT_SYNC_TIMEOUT_MS = 60_000

export type CaptureErrorCode = 'empty' | 'offline' | 'forbidden' | 'timeout'

export class CaptureError extends Error {
	code: CaptureErrorCode

	constructor (code: CaptureErrorCode, message: string) {
		super(message)
		this.name = 'CaptureError'
		this.code = code
	}
}

function pad (value: number): string {
	return String(value).padStart(2, '0')
}

/** Client-local `HH:MM`, matching the daily-page timezone decision in DN-T1. */
export function captureTimeLabel (date: Date): string {
	return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * Turn raw capture input into one Inbox bullet line.
 *
 * `#tag` and `[[wikilink]]` are left verbatim: the graph index derives tags and
 * links from the page text, and the Wikilink extension decorates `[[…]]` in the
 * editor. Only the `#inbox` marker is managed here, and only once. Newlines
 * collapse because a capture is a single bullet.
 */
export function buildCaptureText (text: string, now: Date): string | null {
	const body = String(text ?? '').replace(/\s+/g, ' ').trim()
	if (!body) return null

	const withTag = INBOX_TAG_RE.test(body) ? body : `${body} #${CAPTURE_INBOX_TAG}`
	return `${captureTimeLabel(now)} ${withTag}`
}

function elementText (element: Y.XmlElement): string {
	let text = ''
	for (const child of element.toArray()) {
		if (child instanceof Y.XmlText) {
			text += child.toString()
		} else if (child instanceof Y.XmlElement) {
			text += elementText(child)
		}
	}
	return text
}

function isHeading (node: Y.XmlElement): boolean {
	return node.nodeName === 'heading'
}

function headingLevel (node: Y.XmlElement): number {
	const level = Number(node.getAttribute('level') ?? 1)
	return Number.isFinite(level) ? level : 1
}

function isInboxHeading (node: Y.XmlElement): boolean {
	return isHeading(node) && elementText(node).trim().toLowerCase() === CAPTURE_INBOX_HEADING.toLowerCase()
}

function textType (text: string): Y.XmlText {
	const node = new Y.XmlText()
	node.insert(0, text)
	return node
}

function headingElement (level: number, text: string): Y.XmlElement {
	const heading = new Y.XmlElement('heading')
	// Yjs attribute values are untyped at runtime; y-prosemirror writes the PM
	// attr values as-is (numbers/booleans), so match that exactly. The string
	// casts only satisfy Yjs' attribute typings.
	heading.setAttribute('level', level as unknown as string)
	heading.insert(0, [textType(text)])
	return heading
}

function captureListItem (bulletText: string): Y.XmlElement {
	const item = new Y.XmlElement('listItem')
	const paragraph = new Y.XmlElement('paragraph')
	paragraph.insert(0, [textType(bulletText)])
	item.insert(0, [paragraph])
	return item
}

function captureBulletList (bulletText: string): Y.XmlElement {
	const list = new Y.XmlElement('bulletList')
	list.insert(0, [captureListItem(bulletText)])
	return list
}

function topLevelElements (fragment: Y.XmlFragment): Array<Y.XmlElement | Y.XmlText | Y.XmlHook> {
	return fragment.toArray()
}

function isElement (node: unknown): node is Y.XmlElement {
	return node instanceof Y.XmlElement
}

export interface AppendCaptureOptions {
	pageId: string
	token: string
	text: string
	now?: Date
	/** Sync-server URL override (tests / non-default deployments). */
	wsUrl?: string
	syncTimeoutMs?: number
	/** Injection seam for tests; production uses the y-websocket provider. */
	connect?: CaptureConnector
}

export interface AppendCaptureResult {
	bulletText: string
}

export interface CaptureConnection {
	/** Resolves once the Yjs document has received the server's full state. */
	synced: Promise<void>
	/** Resolves once the local update has left the client. */
	flush: () => Promise<void>
	destroy: () => void
}

export interface CaptureConnectionParams {
	pageId: string
	token: string
	wsUrl: string
}

export type CaptureConnector = (
	doc: Y.Doc,
	params: CaptureConnectionParams,
) => CaptureConnection | Promise<CaptureConnection>

export interface AppendCaptureToDocOptions {
	text: string
	now: Date
}

/**
 * Append the capture bullet to a page's Yjs document.
 *
 * The Inbox section is the last top-level bullet list between the `Inbox`
 * heading and the next heading of level ≤ 2. When the section is missing it is
 * created at the end of the page; when the page is empty (a freshly created
 * daily page) an empty leading heading is seeded first, matching
 * `EMPTY_PAGE_DOC` and the export engine's "title lives in frontmatter, not a
 * duplicated body heading" convention. Everything happens in one Yjs
 * transaction, so collaborators receive a single atomic update.
 *
 * Returns the bullet line that was written, or `null` for an empty capture.
 */
export function appendCaptureBlockToYDoc (
	ydoc: Y.Doc,
	options: AppendCaptureToDocOptions,
): string | null {
	const bulletText = buildCaptureText(options.text, options.now)
	if (!bulletText) return null

	const fragment = ydoc.getXmlFragment(CAPTURE_FRAGMENT_FIELD)

	ydoc.transact(() => {
		const children = topLevelElements(fragment)
		const isEmptyPage =
			children.length === 0 ||
			(children.length === 1 &&
				isElement(children[0]) &&
				isHeading(children[0]) &&
				elementText(children[0]).trim() === '')

		if (isEmptyPage) {
			if (fragment.length > 0) {
				fragment.delete(0, fragment.length)
			}
			fragment.insert(0, [
				headingElement(1, ''),
				headingElement(INBOX_SECTION_LEVEL, CAPTURE_INBOX_HEADING),
				captureBulletList(bulletText),
			])
			return
		}

		const elements = children.filter(isElement)
		const inboxIndex = elements.findIndex(isInboxHeading)

		if (inboxIndex === -1) {
			fragment.insert(fragment.length, [
				headingElement(INBOX_SECTION_LEVEL, CAPTURE_INBOX_HEADING),
				captureBulletList(bulletText),
			])
			return
		}

		// Section end = the next heading that starts a sibling section.
		let sectionEnd = elements.length
		for (let index = inboxIndex + 1; index < elements.length; index++) {
			const node = elements[index]
			if (isHeading(node) && headingLevel(node) <= INBOX_SECTION_LEVEL) {
				sectionEnd = index
				break
			}
		}

		// Append to the section's last top-level bullet list, if it has one.
		let lastList: Y.XmlElement | null = null
		for (let index = inboxIndex + 1; index < sectionEnd; index++) {
			const node = elements[index]
			if (node.nodeName === 'bulletList') lastList = node
		}

		if (lastList) {
			lastList.insert(lastList.length, [captureListItem(bulletText)])
		} else {
			fragment.insert(sectionEnd, [captureBulletList(bulletText)])
		}
	})

	return bulletText
}

function withTimeout<T> (promise: Promise<T>, timeoutMs: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new CaptureError('timeout', 'The sync server did not respond in time.'))
		}, timeoutMs)

		promise.then(
			value => { clearTimeout(timer); resolve(value) },
			error => { clearTimeout(timer); reject(error) },
		)
	})
}

async function flushSocket (provider: { ws?: WebSocket | null }): Promise<void> {
	const socket = provider.ws
	// WebSocket.OPEN === 1; compare numerically so non-browser runtimes without
	// a global WebSocket constant cannot throw here.
	if (socket && socket.readyState === 1) {
		const deadline = Date.now() + 2_000
		while (socket.bufferedAmount > 0 && Date.now() < deadline) {
			await new Promise(resolve => setTimeout(resolve, 25))
		}
		// The frame is on the wire; give the server a beat to ingest it before
		// the socket closes (there is no per-update acknowledgement).
		await new Promise(resolve => setTimeout(resolve, 200))
	}
}

/** Production connector: the same room/token shape `useEditorCollab` uses. */
const websocketConnector: CaptureConnector = async (doc, { pageId, token, wsUrl }) => {
	const { WebsocketProvider } = await import('y-websocket')
	const provider = new WebsocketProvider(wsUrl, pageId, doc, {
		params: { token, documentId: pageId },
		connect: true,
	})

	const synced = new Promise<void>((resolve) => {
		// A cold sync hub can fail the first attempts and retry for up to a
		// minute; `connection-error` is not fatal here, the caller's timeout is.
		if (provider.synced) {
			resolve()
			return
		}
		const handleSync = (isSynced: boolean) => {
			if (!isSynced) return
			provider.off('sync', handleSync)
			resolve()
		}
		provider.on('sync', handleSync)
	})

	return {
		synced,
		flush: () => flushSocket(provider),
		destroy: () => provider.destroy(),
	}
}

/**
 * Append one capture into a Page's Inbox section via the page's CRDT channel.
 *
 * The Y.Doc is created here, synced with the server, mutated, flushed, and torn
 * down. No page body is ever written through the database.
 */
export async function appendCaptureBlock (
	options: AppendCaptureOptions,
): Promise<AppendCaptureResult> {
	const now = options.now ?? new Date()
	const bulletText = buildCaptureText(options.text, now)
	if (!bulletText) {
		throw new CaptureError('empty', 'Type something to capture first.')
	}

	const ydoc = new Y.Doc()
	const wsUrl = options.wsUrl ?? process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:8080'
	const connect = options.connect ?? websocketConnector

	let connection: CaptureConnection | null = null

	try {
		connection = await connect(ydoc, { pageId: options.pageId, token: options.token, wsUrl })
		await withTimeout(connection.synced, options.syncTimeoutMs ?? DEFAULT_SYNC_TIMEOUT_MS)

		appendCaptureBlockToYDoc(ydoc, {
			text: options.text,
			now,
		})

		await connection.flush()
		return { bulletText }
	} finally {
		if (connection) connection.destroy()
		ydoc.destroy()
	}
}
