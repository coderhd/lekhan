# Notion export fixtures

These zips replicate the on-disk shape of Notion's **Export → Markdown & CSV**
output (workspace or page export):

- every page file and page folder is suffixed with a 32-hex id
  (`Roadmap 44444444444444444444444444444444.md`);
- database folders contain one CSV per exported view (`*_all.csv` plus a view)
  and one Markdown file per row;
- internal links are URL-encoded relative paths carrying the target's id;
  relation links also appear as `https://www.notion.so/Title-<32hex>`;
- images live inside UUID-suffixed attachment folders;
- callouts are exported as one-row/two-cell HTML tables;
- synced blocks carry an HTML comment marker;
- `__MACOSX/` and `.DS_Store` junk is present because real zips contain it.

`multi-part/part-1.zip` + `part-2.zip` model a workspace export that Notion
split into multiple downloads, including a page that appears in both parts.

## Provenance and scope

These fixtures are **hand-built from Notion's documented export layout and
observed community tooling**, not copied from a third-party workspace (no
personal data is committed). They are deterministic (fixed timestamps), tiny,
and committed as binaries so the importer suite exercises real zip decoding.

Real-export fidelity is a separate QA gate for SIL-58: the QA engineer
dogfoods an actual Notion export before the REVIEW gate. Any format drift found
there becomes a new fixture + regression test rather than a silent parser
change.
