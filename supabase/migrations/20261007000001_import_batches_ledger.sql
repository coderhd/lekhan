-- #87 — Idempotent bulk imports: per-batch import ledger.
--
-- POST /api/import is multi-batch for large vaults (48 MB client budget, 64 MB
-- server ceiling). Each batch's leaf insert is one atomic statement, and folder
-- chains are reused server-side, so hierarchy never duplicates — but leaf pages
-- do. If batch 1 lands and batch 2 fails, a full retry would re-create every
-- leaf from batch 1.
--
-- This ledger records each (workspace, client_import_id, batch_index) exactly
-- once. A retry of a landed batch is answered from the recorded report instead
-- of re-writing pages, and reports honest partial progress.
--
-- client_import_id is a client-generated uuid, stable for one import
-- attempt-session (the browser dialog reuses it across retries). Rows are
-- retained briefly for audit/resume and can be pruned with
-- cleanup_import_batches(); they cascade away with their workspace.

CREATE TABLE IF NOT EXISTS public.import_batches (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
	owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
	client_import_id UUID NOT NULL,
	batch_index INTEGER NOT NULL CHECK (batch_index >= 0),
	status TEXT NOT NULL DEFAULT 'processing'
		CHECK (status IN ('processing', 'completed', 'failed')),
	-- Recorded report: what the batch created, surfaced verbatim on a replay.
	imported_count INTEGER NOT NULL DEFAULT 0,
	pages JSONB NOT NULL DEFAULT '[]'::jsonb,
	warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
	created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
	updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc'::text, now()),
	-- The idempotency key. One row per batch per attempt-session. The unique
	-- index also serves the (workspace_id, client_import_id) prefix lookups used
	-- to list an attempt's landed batches.
	UNIQUE (workspace_id, client_import_id, batch_index)
);

ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;

-- Read-own: the owner of the target workspace may inspect their import ledger.
-- All writes are service-role only (the /api/import route's admin client).
DROP POLICY IF EXISTS select_import_batches ON public.import_batches;
CREATE POLICY select_import_batches ON public.import_batches
	FOR SELECT TO authenticated
	USING (
		EXISTS (
			SELECT 1 FROM public.workspaces w
			WHERE w.id = import_batches.workspace_id AND w.owner_id = auth.uid()
		)
	);

-- Prune ledger rows older than retain_days (the audit window): completed rows
-- are kept briefly for audit/resume, while failed/abandoned (processing) rows
-- are pruned too so repeated failures cannot grow the table without bound.
-- Intended for an ops/cron call; not wired to a schedule in this slice.
CREATE OR REPLACE FUNCTION public.cleanup_import_batches(retain_days integer DEFAULT 30)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
	deleted_count integer;
BEGIN
	DELETE FROM public.import_batches
	WHERE updated_at < timezone('utc'::text, now()) - make_interval(days => retain_days);
	GET DIAGNOSTICS deleted_count = ROW_COUNT;
	RETURN deleted_count;
END;
$$;

-- Server-only: invoked through the service key (or a future cron), exactly like
-- public.sync_page_graph. PUBLIC/anon/authenticated are revoked so a client
-- cannot call this SECURITY DEFINER function via the REST rpc and wipe every
-- tenant's ledger (which would defeat idempotency and destroy audit rows).
REVOKE EXECUTE ON FUNCTION public.cleanup_import_batches(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_import_batches(integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_import_batches(integer) TO service_role;
