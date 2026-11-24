export const workspaceManifestPath = '.lekhan-workspace.json'

export interface ArchivedNote {
  title: string
  generatedHeading: boolean
}

export interface WorkspaceArchiveMetadata {
  version: 1
  notes: Record<string, ArchivedNote>
  attachments: string
}

export function readWorkspaceArchiveMetadata(source: string): WorkspaceArchiveMetadata | undefined {
  try {
    const value: unknown = JSON.parse(source)
    if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1
      || !('notes' in value) || !value.notes || typeof value.notes !== 'object' || Array.isArray(value.notes)
      || !('attachments' in value) || typeof value.attachments !== 'string' || !/^Attachments(?: \(\d+\))?$/.test(value.attachments)) return
    const notes = new Map<string, ArchivedNote>()
    for (const [path, note] of Object.entries(value.notes)) {
      if (!note || typeof note !== 'object' || !('title' in note) || typeof note.title !== 'string' || !note.title.trim()
        || !('generatedHeading' in note) || typeof note.generatedHeading !== 'boolean') return
      notes.set(path, { title: note.title, generatedHeading: note.generatedHeading })
    }
    return { version: 1, notes: Object.fromEntries(notes), attachments: value.attachments }
  } catch {
    return
  }
}
