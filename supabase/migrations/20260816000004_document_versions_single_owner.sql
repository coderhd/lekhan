-- Review follow-up: a version record must belong to exactly one entity —
-- either a legacy document or a page. All writers already produce exactly one
-- (version-history.tsx and /api/version page branch write page_id; the legacy
-- paths write document_id), so this pins the invariant.

ALTER TABLE public.document_versions
	ADD CONSTRAINT document_versions_single_owner_check
	CHECK (num_nonnulls(document_id, page_id) = 1);