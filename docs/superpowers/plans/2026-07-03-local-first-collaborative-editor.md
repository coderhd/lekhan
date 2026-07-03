# Local-First Collaborative Document Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a secure, local-first, collaborative document editor with offline sync, PostgreSQL RLS, version control, in-app notifications, and Sarvam AI multilingual translation and Text-to-Speech (TTS) capabilities.

**Architecture:** A hybrid architecture combining a Next.js 16 web app and a custom Node.js WebSocket sync server. Real-time document merging uses Yjs CRDTs stored as files in Supabase Storage to keep PostgreSQL database limits low, with a local SSD Write-Ahead Log (WAL) on the sync server to buffer active writes.

**Tech Stack:** Next.js 16 (App Router), Supabase Auth/PostgreSQL/Storage, Custom ws-based Node.js server, Yjs, y-indexeddb, y-websocket, Tiptap, Tailwind CSS, Shadcn UI, and Sarvam AI APIs.

## Global Constraints

*   Use tab indentation for files.
*   Use single quotes for strings (unless escaping is needed).
*   Omit semicolons (unless required for parsing disambiguation).
*   Add a space after keywords (e.g. `if (`, `for (`, `catch (`) and before function parentheses.
*   Always use strict equality (`===`) instead of loose equality (`==`).
*   Space infix operators (e.g., `const a = 1 + 2`) and after commas.
*   Keep `else` statements on the same line as closing curly braces: `} else {`.
*   Always use curly braces for multi-line `if` statements.
*   Limit line length to 80 characters.
*   Use trailing commas in multiline object/array literals.

---

### Task 1: Scaffolding, Dependencies, and Configuration

**Files:**
*   Create: `package.json`
*   Create: `tsconfig.json`
*   Create: `tailwind.config.js`
*   Create: `vitest.config.ts`
*   Create: `tests/setup.ts`

**Interfaces:**
*   Produces: Basic React/Next.js and Vitest configurations.

- [ ] **Step 1: Scaffold the directory and create package.json**
	Initialize `package.json` with the following packages:
	```json
	{
		"name": "local-first-collaborative-editor",
		"version": "0.1.0",
		"private": true,
		"scripts": {
			"dev": "next dev",
			"build": "next build",
			"start": "next start",
			"server": "node server/index.js",
			"test": "vitest"
		},
		"dependencies": {
			"@radix-ui/react-avatar": "^1.1.0",
			"@radix-ui/react-dialog": "^1.1.1",
			"@radix-ui/react-dropdown-menu": "^2.1.1",
			"@radix-ui/react-label": "^2.1.0",
			"@radix-ui/react-slot": "^1.1.0",
			"@supabase/supabase-js": "^2.44.0",
			"@tiptap/extension-collaboration": "^2.4.0",
			"@tiptap/extension-collaboration-cursor": "^2.4.0",
			"@tiptap/pm": "^2.4.0",
			"@tiptap/react": "^2.4.0",
			"@tiptap/starter-kit": "^2.4.0",
			"better-sqlite3": "^11.1.2",
			"class-variance-authority": "^0.7.0",
			"clsx": "^2.1.1",
			"lucide-react": "^0.400.0",
			"next": "14.2.4",
			"react": "^18.3.1",
			"react-dom": "^18.3.1",
			"tailwind-merge": "^2.3.0",
			"tailwindcss-animate": "^1.0.7",
			"ws": "^8.18.0",
			"y-indexeddb": "^9.0.12",
			"y-websocket": "^2.0.4",
			"yjs": "^13.6.15"
		},
		"devDependencies": {
			"@types/better-sqlite3": "^7.6.11",
			"@types/node": "^20.14.9",
			"@types/react": "^18.3.3",
			"@types/react-dom": "^18.3.0",
			"@types/ws": "^8.5.10",
			"autoprefixer": "^10.4.19",
			"postcss": "^8.4.38",
			"tailwindcss": "^3.4.4",
			"typescript": "^5.5.2",
			"vitest": "^1.6.0"
		}
	}
	```

- [ ] **Step 2: Create config files**
	Write standard configurations matching the project style rules. For example, `tsconfig.json` should have `strict: true`.

- [ ] **Step 3: Run npm install**
	Run: `npm install`

- [ ] **Step 4: Create setup.ts and configuration for Vitest**
	Write `/tests/setup.ts` to mock browser environments like IndexedDB and WebSocket.
	Run: `npm run test` to verify Vitest boots.

- [ ] **Step 5: Commit changes**
	Run: `git add .`
	Run: `git commit -m "chore: setup scaffolding and configurations"`

---

### Task 2: Supabase Schema and RLS Policies

**Files:**
*   Create: `supabase/migrations/20260703000000_init_schema.sql`

**Interfaces:**
*   Produces: SQL tables and RLS security models in the database.

- [ ] **Step 1: Write SQL schema migration file**
	Define tables: `profiles`, `documents`, `document_members`, `document_invitations`, and `document_versions`. Add triggers to auto-create a user profile row whenever a new user registers in Supabase Auth.
	```sql
	-- Create Tables
	CREATE TABLE public.profiles (
		id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
		email TEXT UNIQUE NOT NULL,
		full_name TEXT,
		avatar_url TEXT,
		created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
	);

	CREATE TABLE public.documents (
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		title TEXT DEFAULT 'Untitled Document' NOT NULL,
		owner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
		searchable_text TEXT DEFAULT '',
		is_public BOOLEAN DEFAULT false NOT NULL,
		created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
		updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
	);

	CREATE TYPE member_role AS ENUM ('owner', 'editor', 'viewer');

	CREATE TABLE public.document_members (
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
		user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
		role member_role NOT NULL,
		created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
		UNIQUE (document_id, user_id)
	);

	CREATE TYPE invitation_status AS ENUM ('pending', 'accepted', 'declined');

	CREATE TABLE public.document_invitations (
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
		inviter_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
		invitee_email TEXT NOT NULL,
		role member_role NOT NULL,
		token UUID NOT NULL DEFAULT gen_random_uuid(),
		status invitation_status DEFAULT 'pending' NOT NULL,
		created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
	);

	CREATE TABLE public.document_versions (
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
		version_name TEXT NOT NULL,
		created_by UUID NOT NULL REFERENCES public.profiles(id),
		created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
	);

	-- Trigger to automatically create profile on sign up
	CREATE OR REPLACE FUNCTION public.handle_new_user()
	RETURNS TRIGGER AS $$
	BEGIN
		INSERT INTO public.profiles (id, email, full_name, avatar_url)
		VALUES (
			new.id,
			new.email,
			new.raw_user_meta_data->>'full_name',
			new.raw_user_meta_data->>'avatar_url'
		);
		RETURN new;
	END;
	$$ LANGUAGE plpgsql SECURITY DEFINER;

	CREATE TRIGGER on_auth_user_created
		AFTER INSERT ON auth.users
		FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
	```

- [ ] **Step 2: Enable RLS and define security policies in the migration**
	Add policies to restrict access based on the `document_members` mapping and `is_public` settings.
	```sql
	ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
	ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
	ALTER TABLE public.document_members ENABLE ROW LEVEL SECURITY;
	ALTER TABLE public.document_invitations ENABLE ROW LEVEL SECURITY;
	ALTER TABLE public.document_versions ENABLE ROW LEVEL SECURITY;

	-- documents SELECT Policy
	CREATE POLICY select_document ON public.documents
		FOR SELECT USING (
			owner_id = auth.uid() OR
			is_public = true OR
			EXISTS (
				SELECT 1 FROM public.document_members 
				WHERE document_id = id AND user_id = auth.uid()
			)
		);

	-- documents UPDATE Policy
	CREATE POLICY update_document ON public.documents
		FOR UPDATE USING (
			owner_id = auth.uid() OR
			EXISTS (
				SELECT 1 FROM public.document_members 
				WHERE document_id = id AND user_id = auth.uid() AND role = 'editor'
			)
		);
	```

- [ ] **Step 3: Commit changes**
	Run: `git add .`
	Run: `git commit -m "db: add tables, triggers, and row level security policies"`

---

### Task 3: Custom Node.js WebSocket Server & Local WAL Cache

**Files:**
*   Create: `server/index.js`
*   Create: `server/wal.js`
*   Create: `server/auth.js`

**Interfaces:**
*   Consumes: Database RLS credentials.
*   Produces: WebSocket gateway listening on port 8080.
    Handles connections, authenticates Supabase JWTs, checks permissions, buffers keystrokes locally, and saves back to Supabase Storage.

- [ ] **Step 1: Implement server/auth.js for JWT Verification**
	```javascript
	const { createClient } = require('@supabase/supabase-js')

	function getSupabaseClient (token) {
		return createClient(
			process.env.SUPABASE_URL,
			process.env.SUPABASE_ANON_KEY,
			{
				auth: {
					persistSession: false,
					autoRefreshToken: false,
				},
				global: {
					headers: {
						Authorization: `Bearer ${token}`,
					},
				},
			}
		)
	}

	async function verifyUserRole (supabase, documentId) {
		const { data: { user } } = await supabase.auth.getUser()
		if (!user) return null

		const { data: doc } = await supabase
			.from('documents')
			.select('owner_id')
			.eq('id', documentId)
			.single()

		if (doc && doc.owner_id === user.id) {
			return 'owner'
		}

		const { data: member } = await supabase
			.from('document_members')
			.select('role')
			.eq('document_id', documentId)
			.eq('user_id', user.id)
			.single()

		return member ? member.role : null
	}

	module.exports = { getSupabaseClient, verifyUserRole }
	```

- [ ] **Step 2: Implement server/wal.js for SQLite caching**
	Set up a local SQLite file database to write incoming updates instantly before batching.
	```javascript
	const Database = require('better-sqlite3')
	const db = new Database('wal.db')

	db.exec(`
		CREATE TABLE IF NOT EXISTS update_log (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			document_id TEXT NOT NULL,
			update_bin BLOB NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)
	`)

	const insertStmt = db.prepare(`
		INSERT INTO update_log (document_id, update_bin) VALUES (?, ?)
	`)
	const selectStmt = db.prepare(`
		SELECT update_bin FROM update_log WHERE document_id = ? ORDER BY id
	`)
	const deleteStmt = db.prepare(`
		DELETE FROM update_log WHERE document_id = ?
	`)

	function appendUpdate (documentId, binary) {
		insertStmt.run(documentId, binary)
	}

	function getPendingUpdates (documentId) {
		return selectStmt.all(documentId).map(row => row.update_bin)
	}

	function clearUpdates (documentId) {
		deleteStmt.run(documentId)
	}

	module.exports = { appendUpdate, getPendingUpdates, clearUpdates }
	```

- [ ] **Step 3: Implement main WebSocket server (server/index.js)**
	Create a custom WebSocket logic utilizing Yjs server-side representation, connection validations, and a 10-minute/idle batch flush.
	Include viewer payload rejection.

- [ ] **Step 4: Commit**
	Run: `git add .`
	Run: `git commit -m "feat: add websocket server with SQLite WAL cache"`

---

### Task 4: Next.js 16 Dashboard & Authentication

**Files:**
*   Create: `app/layout.tsx`
*   Create: `app/page.tsx`
*   Create: `app/login/page.tsx`
*   Create: `components/dashboard.tsx`
*   Create: `components/invitations.tsx`

**Interfaces:**
*   Produces: App navigation framework, glassmorphic login interface, document list views, and invitation accept/decline action triggers.

- [ ] **Step 1: Build the layout and base styles**
	Initialize metadata, Google Inter font, and basic global stylesheet.

- [ ] **Step 2: Build app/login/page.tsx**
	Create sign-up and login inputs styling with glassmorphism and validation logic via Supabase Auth client.

- [ ] **Step 3: Create dashboard and list tables**
	Create dashboard interface showing:
	*   "My Documents" list.
	*   "Shared with Me" list.
	*   "New Document" creation action.

- [ ] **Step 4: Build invitations list container (components/invitations.tsx)**
	Fetch pending rows from `document_invitations`. Allow clicking "Accept" (add row to `document_members` and delete invitation) or "Decline" (delete invitation).

- [ ] **Step 5: Commit**
	Run: `git add .`
	Run: `git commit -m "feat: add auth login pages and dashboard interfaces"`

---

### Task 5: Document Editor Component (Tiptap + Yjs + IndexedDB)

**Files:**
*   Create: `app/doc/[id]/page.tsx`
*   Create: `components/editor-workspace.tsx`
*   Create: `components/sync-indicator.tsx`
*   Create: `hooks/use-editor-collab.ts`

**Interfaces:**
*   Produces: Document editing workspace. Synchronizes editing state to local IndexedDB and transmits deltas via WS with collaborative colored cursors.

- [ ] **Step 1: Write use-editor-collab.ts custom hook**
	Initialize `Y.Doc`, connect `y-indexeddb` to load document state instantly, and spawn a `y-websocket` provider pointing to the server. Synchronize cursor presence mapping names and border colors.

- [ ] **Step 2: Implement components/sync-indicator.tsx**
	Create sync status visual pill in the navbar displaying state: Cloud Check (Synced), Spinning Wheel (Syncing), Cloud Strike (Offline).

- [ ] **Step 3: Create components/editor-workspace.tsx**
	Assemble Tiptap Editor Canvas. Attach collaboration extension bound to the Yjs doc.
	Add `beforeunload` event handler blocking tab close if local changes haven't been acknowledged by server.
	Add footer containing creator name, GitHub profile, and LinkedIn profile.

- [ ] **Step 4: Commit**
	Run: `git add .`
	Run: `git commit -m "feat: implement local-first collaborative tiptap editor"`

---

### Task 6: Collaboration Invites and Share Dialog

**Files:**
*   Create: `components/share-modal.tsx`
*   Create: `app/invite/[token]/page.tsx`

**Interfaces:**
*   Produces: Share Modal dialog inside the editor canvas, and token-based landing invitation portal.

- [ ] **Step 1: Build components/share-modal.tsx**
	Add interface to invite other accounts.
	Add input email and toggle select mapping role `'editor'` or `'viewer'`.
	Generate unique URL: `/invite/{invitation_token}`.
	Create Mailto action button:
	```html
	<a href="mailto:?subject=Join my collaborative document&body=Accept link: https://collab-editor.com/invite/{token}">Share via Email</a>
	```
	Add a toggle for public view state: `is_public` changing documents RLS accessibility.

- [ ] **Step 2: Create invitation onboarding landing page**
	Create `app/invite/[token]/page.tsx`. Verify token validation. If authenticated, present "Accept" or "Decline" dashboard buttons; if unauthenticated, save token to cookie and redirect to signup.

- [ ] **Step 3: Commit**
	Run: `git add .`
	Run: `git commit -m "feat: add share modals, mailto generation, and link onboarding"`

---

### Task 7: Version History & Time Travel

**Files:**
*   Create: `components/version-history.tsx`
*   Create: `app/api/version/route.ts`

**Interfaces:**
*   Produces: Timeline side panel and API route to fetch and commit Yjs snapshots to Supabase storage.

- [ ] **Step 1: Build version capture and timeline panel**
	Add "Save Version" input triggering snapshot upload to `/api/version`. Render database timeline list.

- [ ] **Step 2: Implement safe revert logic**
	When clicked "Restore", load version snapshot from storage bucket. Find delta difference relative to active state in memory and append as single revert transaction.

- [ ] **Step 3: Commit**
	Run: `git add .`
	Run: `git commit -m "feat: implement version history snapshots and time travel reverts"`

---

### Task 8: Sarvam AI Indian-Flavor Integration

**Files:**
*   Create: `app/api/ai/route.ts`
*   Create: `components/ai-assistant-panel.tsx`
*   Create: `components/ai-bubble-menu.tsx`

**Interfaces:**
*   Consumes: Sarvam AI subscription key.
*   Produces: Indian language translations, TTS text-to-speech audio controls, and Sarvam-30B assistant.

- [ ] **Step 1: Create Next.js API router server-side proxy**
	Implement `/api/ai/route.ts` communicating with Sarvam AI API endpoints. Check Auth headers.
	Endpoints to handle:
	*   `POST https://api.sarvam.ai/v1/chat/completions` (using `sarvam-30b`)
	*   `POST https://api.sarvam.ai/translate` (using `sarvam-translate:v1`)
	*   `POST https://api.sarvam.ai/text-to-speech` (using `bulbul:v3` and `speech_sample_rate: 24000`)

- [ ] **Step 2: Build AI Translation & Speech Toolbar**
	Create editor floating menu actions to translate selected text into Hindi, Tamil, Telugu, etc.
	Add TTS button fetching audio stream from API, loading it in an HTML5 Web Audio sidebar player to speak text in selected voice (Shubh/Aarav).

- [ ] **Step 3: Commit**
	Run: `git add .`
	Run: `git commit -m "feat: integrate Sarvam AI translation, TTS speech, and chat helper"`

---

### Task 9: Automated Verification & Testing

**Files:**
*   Create: `tests/yjs-sync.test.ts`
*   Create: `tests/editor-permissions.test.ts`
*   Create: `playwright.config.ts`
*   Create: `tests/e2e/editor-collab.spec.ts`

- [ ] **Step 1: Create Unit Tests for conflict resolution**
	Write tests confirming concurrent update merges using mock Yjs documents.

- [ ] **Step 2: Create E2E playwright script**
	Write tests opening two browser pages editing a collaborative document simultaneously and verification of offline sync state upon network toggle simulation.

- [ ] **Step 3: Run all tests**
	Run: `npx playwright test`
	Run: `npm run test`

- [ ] **Step 4: Commit**
	Run: `git add .`
	Run: `git commit -m "test: add unit and playwright e2e tests"`
