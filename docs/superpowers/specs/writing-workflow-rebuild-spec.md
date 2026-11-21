# Lekhan writing workspace rebuild

The rebuild starts at the first H0–H3 roadmap commit, `cffafe9`. The first milestone is the personal writing workflow. Live collaboration follows as a separate milestone.

## Acceptance criteria

- Open the workspace without signing in. Create, rename, nest, favorite, and move pages without losing their content or breaking page links. Delete a page only after confirming the scope.
- Write in a rich editor. Use keyboard input or visible controls to add headings, lists, tasks, quotes, and code. Typing `/` offers block commands and typing `[[` offers pages to link. Both menus support keyboard selection and dismissal.
- Navigate between pages with the sidebar, breadcrumbs, keyboard search, and inline links. Search matches titles and Markdown body text. Page context shows the outline and inbound links, and updates as pages change.
- Save locally and show the status of the durable write. Reopening the same browser restores pages. Prevent a second tab from silently overwriting a more recent workspace revision.
- Import Markdown files into the workspace and export a page or the complete workspace as Markdown. Preserve the supported block types and wikilinks. Imported files start with their original Markdown. Edit source directly when the visual editor cannot preserve an imported construct.
- Make all essential actions usable by keyboard and on a narrow display. Test actual navigation, creation, editing, links, search, reload recovery, and import/export in Chromium.

## Reference behavior

Notion's public page uses readable headings, short content blocks, and inline links. REA browser evidence `ev_92541344f86bccf095569798a583438b01a59dda3d063b5abaaf888d2697b696` covers this published page. The editing behavior comes from the official [writing guide](https://www.notion.com/help/writing-and-editing-basics).

Obsidian's help describes keyboard-first page switching, editable wikilinks, and contextual backlinks. REA inventoried the local desktop bundle in `ev_2551f14bc538459ea4fa07ed9fc670eee5fe341bcefa8c648affdc760caa3acf`. Static inventory alone does not establish runtime behavior. [Quick switcher](https://obsidian.md/help/plugins/quick-switcher) · [Internal links](https://obsidian.md/help/links) · [Backlinks](https://obsidian.md/help/plugins/backlinks)

Lekhan uses its own interface. A pale green index frames a paper-colored writing surface, with a quiet serif page title and a side panel that follows the current page. Controls sit next to the text or navigation they affect. The browser-based milestone stores the pages in IndexedDB and offers Markdown files through import and export.

## Verification

Run `npm run typecheck && npm run lint && npm test && npm run build`. Exercise a fresh workspace and reopen an existing workspace in Chromium at desktop and phone widths.
