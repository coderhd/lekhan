-- P2 review follow-up: document_versions.document_id was NOT NULL from the
-- legacy schema, but page-backed version records (version-history.tsx
-- checkpoint save, app/api/version/route.ts page branch) insert page-only
-- rows and omit document_id — every such insert fails with a NOT NULL
-- violation. Allow page-only records; legacy rows written before the
-- cutover keep their document_id.

ALTER TABLE public.document_versions
	ALTER COLUMN document_id DROP NOT NULL;