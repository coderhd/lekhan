# Lekhan - Collaborative Local-First Editor

Welcome to **Lekhan**, a premium collaborative document editor featuring a local-first architecture, offline synchronization, and AI capabilities. This project was developed as part of the House of EdTech Assignment.

## 🚀 Features

- **Local-First Architecture:** The editor prioritizes local state. Changes are reflected instantly and synchronized with the cloud asynchronously in the background.
- **Offline Support:** You can open, edit, and safely close documents entirely offline. Once a network connection is re-established, the sync engine resolves conflicts and pushes changes.
- **Real-time Collaboration:** Multiple users can edit simultaneously using robust conflict resolution.
- **Role-Based Authorization:** Strict permission levels (Owner, Editor, Viewer). Viewers can see documents but cannot push state modifications.
- **AI Integrations:** Enhance your writing with built-in AI tools directly inside the editor.
- **Version History:** Track changes and traverse document history safely.

## 🏗️ Architecture Overview

The application utilizes a modern, edge-ready architecture to deliver low-latency real-time collaboration:

1. **Frontend / Framework:** Built with **Next.js 16** (App Router) and **React 19**, styled using **Tailwind CSS** and **Shadcn UI**.
2. **Database & Real-time:** Powered by **Supabase**. Handles authentication, Postgres database storage, and real-time WebSockets.
3. **Local-First Sync Engine:** The editor utilizes a synchronization layer that batches operations locally. This ensures zero network blocking on the UI thread while guaranteeing deterministic eventual consistency across all connected clients.
4. **Testing Suite:** Comprehensive testing strategy employing **Vitest** for unit/integration tests and **Playwright** for End-to-End (E2E) testing.

## 📂 Folder Structure

```text
├── app/                  # Next.js 16 App Router components (pages, layouts, and API routes)
│   ├── doc/[id]/         # Dynamic route for the collaborative document editor workspace
│   ├── invite/[token]/   # Route for handling user invitations to documents
│   └── globals.css       # Global styles (Tailwind directives)
├── components/           # Reusable UI components
│   ├── ui/               # Base Shadcn UI components
│   ├── layout/           # Global layout components like global-footer.tsx
│   ├── editor-workspace.tsx # Core collaborative editor component
│   └── ai-assistant-panel.tsx # AI integration interface
├── lib/                  # Utilities and generic helpers (e.g., Supabase client setup)
├── services/             # Abstraction layer for database and external APIs
│   └── db.ts             # Contains fetch operations for documents, invitations, and roles
├── supabase/             # Supabase configuration and SQL migrations
└── tests/                # Testing suite
    ├── e2e/              # Playwright E2E tests for simulating user flows
    └── unit/             # Vitest unit test files for the sync engine and UI
```

## 🔑 Important Files

- `app/layout.tsx`: The root layout of the application. It handles global fonts (via `<head> <link>` tags to bypass Turbopack `@import` limitations), the theme provider, global state, and the `GlobalFooter`.
- `app/doc/[id]/page.tsx`: The primary workspace entry point. In Next.js 16, dynamic params (`params.id`) are asynchronous and must be unwrapped using `React.use()`.
- `services/db.ts`: Handles all interaction with the Supabase database. Includes functions like `fetchDocumentDetails`, which fetches authorization roles to lock down the UI for Viewers.
- `package.json`: Contains project dependencies, updated to Next.js v16 and React v19.

## 💻 Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn

### Installation

1. Clone the repository and install dependencies:
   ```bash
   npm install
   ```
2. Ensure you have the proper environment variables configured in `.env.local` for Supabase:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   ```
3. Run the development server:
   ```bash
   npm run dev
   ```
4. Build for production:
   ```bash
   npm run build
   ```

## 🧪 Testing

The repository contains a robust testing suite fulfilling QA requirements:
- Run Unit Tests: `npm run test`
- Run End-to-End Tests: `npx playwright test`

## 👨‍💻 Author

- **Harsh Dave**
- [GitHub Profile](https://github.com/coderhd)
- [LinkedIn Profile](https://www.linkedin.com/in/harshdave95/)
