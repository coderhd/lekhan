-- Sync Server Hardening: Durable Collaborator Ledger Table (Issue #77)
CREATE TABLE IF NOT EXISTS public.document_collaborators_ledger (
	document_id UUID NOT NULL,
	user_id TEXT NOT NULL,
	first_seen_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
	last_seen_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
	PRIMARY KEY (document_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_collab_ledger_doc_id 
	ON public.document_collaborators_ledger(document_id);

ALTER TABLE public.document_collaborators_ledger ENABLE ROW LEVEL SECURITY;

-- Block direct client manipulation; sync server operates via service_role
CREATE POLICY ledger_service_role_all ON public.document_collaborators_ledger
	FOR ALL TO service_role USING (true) WITH CHECK (true);
