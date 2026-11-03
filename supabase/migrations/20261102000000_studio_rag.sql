-- H3 Studio deep-RAG schema (RAG-1).
-- Spec: docs/superpowers/specs/2026-11-02-h3-studio-rag-agentic-design.md §3
--
-- Scope is the storage foundation only: retrievable chunk rows, one summary
-- embedding per page, and the agent/Studio job ledger. The fused retrieval
-- function (hybrid_search_chunks) belongs to RAG-6 and lands separately.
--
-- Access model mirrors pages: chunk and summary reads are scoped by
-- can_access_page(page_id), evaluated per caller (RLS, no materialised corpus).
-- Writes come from the server-side indexer/worker with the service role, which
-- bypasses RLS, so no authenticated write policies are granted here.

CREATE EXTENSION IF NOT EXISTS vector;

-- pages.id is already unique; the composite key lets chunk/summary rows pin
-- (page_id, workspace_id) to the page's own workspace. Without it a service
-- write could pair page A with workspace B, and workspace-scoped retrieval
-- would surface A's chunks under B (and deleting B would silently drop them).
-- IF NOT EXISTS is not available for table constraints, so guard by name.
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conrelid = 'public.pages'::regclass
		  AND conname = 'pages_id_workspace_id_key'
		  AND contype = 'u'
	) THEN
		ALTER TABLE public.pages
			ADD CONSTRAINT pages_id_workspace_id_key UNIQUE (id, workspace_id);
	END IF;
END;
$$;

-- One row per retrievable block-run. Re-indexed only when content_hash changes.
CREATE TABLE public.page_chunks (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	page_id uuid NOT NULL,
	workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
	chunk_ordinal integer NOT NULL,
	block_id text NOT NULL, -- stable within a page: ordinal + content hash
	heading_path text[] NOT NULL DEFAULT '{}',
	content text NOT NULL,
	token_count integer NOT NULL,
	content_hash text NOT NULL, -- sha256(normalized content + heading_path)
	embedding halfvec(1536),
	embedding_model text, -- 'openai:text-embedding-3-small'
	tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now(),
	UNIQUE (page_id, chunk_ordinal),
	FOREIGN KEY (page_id, workspace_id)
		REFERENCES public.pages (id, workspace_id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX page_chunks_workspace_idx ON public.page_chunks (workspace_id, page_id);
CREATE INDEX page_chunks_tsv_idx ON public.page_chunks USING gin (tsv);
CREATE INDEX page_chunks_embedding_idx ON public.page_chunks
	USING hnsw (embedding halfvec_cosine_ops) WHERE embedding IS NOT NULL;

-- One summary embedding per page: narrows candidates before chunk scoring.
CREATE TABLE public.page_summaries (
	page_id uuid PRIMARY KEY,
	workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
	summary text NOT NULL,
	content_hash text NOT NULL,
	embedding halfvec(1536),
	embedding_model text,
	updated_at timestamptz NOT NULL DEFAULT now(),
	FOREIGN KEY (page_id, workspace_id)
		REFERENCES public.pages (id, workspace_id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX page_summaries_embedding_idx ON public.page_summaries
	USING hnsw (embedding halfvec_cosine_ops) WHERE embedding IS NOT NULL;

-- Agent / Studio runs. One row per job; steps live in JSONB.
CREATE TABLE public.studio_jobs (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
	created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
	kind text NOT NULL CHECK (kind IN ('briefing', 'quiz', 'agent_research', 'changelog')),
	status text NOT NULL DEFAULT 'queued'
		CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
	input jsonb NOT NULL,
	output jsonb,
	error text,
	tokens_in integer NOT NULL DEFAULT 0,
	tokens_out integer NOT NULL DEFAULT 0,
	cost_usd numeric(10, 6) NOT NULL DEFAULT 0,
	started_at timestamptz,
	finished_at timestamptz,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX studio_jobs_workspace_created_idx ON public.studio_jobs (workspace_id, created_at DESC);

COMMENT ON TABLE public.page_chunks IS
	'Retrievable block-run chunks with content hash and halfvec(1536) embedding (H3 RAG).';
COMMENT ON TABLE public.page_summaries IS
	'One summary embedding per page, used to narrow chunk candidates (H3 RAG).';
COMMENT ON TABLE public.studio_jobs IS
	'Agent/Studio job ledger: one row per run, status transitions and token/cost accounting.';

ALTER TABLE public.page_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.page_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_jobs ENABLE ROW LEVEL SECURITY;

-- Chunks are readable exactly when their page is readable (owner/public/member).
CREATE POLICY select_page_chunks ON public.page_chunks
	FOR SELECT TO authenticated USING (public.can_access_page(page_id));

CREATE POLICY select_page_summaries ON public.page_summaries
	FOR SELECT TO authenticated USING (public.can_access_page(page_id));

-- A job is visible to the user who created it; inserts must target a workspace
-- the user owns (H0 workspace authority is owner-only).
CREATE POLICY select_studio_jobs ON public.studio_jobs
	FOR SELECT TO authenticated USING (created_by = auth.uid());

CREATE POLICY insert_studio_jobs ON public.studio_jobs
	FOR INSERT TO authenticated WITH CHECK (
		created_by = auth.uid()
		AND EXISTS (
			SELECT 1 FROM public.workspaces w
			WHERE w.id = workspace_id AND w.owner_id = auth.uid()
		)
	);
