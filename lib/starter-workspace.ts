import type { Page, Workspace } from './types'

const guide = `A place to collect an idea while it’s still taking shape. Give it a page, link it to what you already know, and come back when you have something to add.

## Start with a page

Open [[Quick capture]] to jot down one thought. When it belongs somewhere, move it into [[Projects]] or link it from another page.

> A short note with a good link is easier to find than a perfect note filed away.

## Make it yours

- [x] Open your workspace
- [ ] Write your first page
- [ ] Connect two ideas with a page link

Press \`/\` to add a block, or type \`[[\` to link a page while you write.`

export function starterWorkspace(now = new Date().toISOString()): Workspace {
  const entries = [
    { id: 'field-guide', title: 'Field guide', favorite: true, markdown: guide },
    {
      id: 'quick-capture',
      title: 'Quick capture',
      favorite: true,
      markdown: 'Keep the thoughts you want to make time for. Link back to the [[Field guide]] whenever you need a starting point.\n\n## Inbox\n\n- [ ] Capture a thought worth keeping',
    },
    {
      id: 'projects',
      title: 'Projects',
      markdown: 'Give each project a page for decisions, research, and next steps.\n\n## In progress\n\n- [[Reading list]]',
    },
    {
      id: 'reading-list',
      parentId: 'projects',
      title: 'Reading list',
      markdown: 'Save what you want to read and keep a few lines on what stayed with you.\n\n## To read\n\n- [ ] Add something to read',
    },
    {
      id: 'reference',
      title: 'Reference',
      markdown: 'A home for things worth coming back to.\n\nSee the [[Field guide]] for ideas on linking pages.',
    },
  ] satisfies Array<Pick<Page, 'id' | 'title' | 'markdown'> & Partial<Page>>

  return {
    revision: 0,
    activePageId: 'field-guide',
    pages: entries.map(page => ({
      parentId: null,
      favorite: false,
      createdAt: now,
      updatedAt: now,
      ...page,
    })),
  }
}
