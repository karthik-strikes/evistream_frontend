# eviStream — Frontend

Next.js web application for **eviStream**, an AI-powered platform for extracting structured data from research papers (systematic reviews, meta-analyses, evidence synthesis).

**Live:** https://evistreams.com · **Try it (no login):** https://evistreams.com/demo

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 3 |
| UI Primitives | Radix UI + lucide-react |
| HTTP | Axios (single `APIClient` with token refresh) |
| Server state | TanStack React Query 5 |
| Client state | React Context + Zustand |
| Forms | React Hook Form + Zod |
| Realtime | WebSocket (live job logs) |

---

## Getting Started

### Prerequisites
- Node.js 18+
- Backend running on `http://localhost:8001`

### Setup
```bash
npm install
cp .env.local.example .env.local
npm run dev            # http://localhost:3000
```

### Scripts
```bash
npm run dev      # dev server (hot reload)
npm run build    # production build
npm start        # start production server
npm run lint     # ESLint
```

### Environment
```env
# .env.local  (git-ignored)
NEXT_PUBLIC_API_URL=http://localhost:8001
```
API calls are made same-origin (`/api/...`) and proxied to the backend via Next.js rewrites (`next.config.js`), avoiding CORS. `.env.local` is never committed — only `.env.local.example` is tracked.

---

## Project Structure

```
frontend/
├── app/
│   ├── layout.tsx / providers.tsx      # root layout, theme + React Query + Auth/Project providers
│   ├── page.tsx                        # landing page
│   ├── middleware.ts                   # route guard (public vs authed)
│   ├── (auth)/
│   │   ├── login/ · register/ · reset-password/
│   │   └── demo/                       # zero-login demo — mints a session, redirects to dashboard
│   └── (dashboard)/
│       ├── dashboard/ · projects/ · documents/ · forms/
│       ├── extractions/ · results/ · jobs/ · manual-extraction/
│       ├── consensus/ · qa/ · data-cleaning/ · vocabularies
│       ├── activity/ · chat/ · usage/ · invitations/ · admin/ · settings/
├── components/                         # layout, ui primitives, feature components (pilot, project, source-evidence, ...)
├── contexts/                           # AuthContext, ProjectContext, ThemeContext
├── services/                           # typed API wrappers (auth, projects, documents, forms, results, usage, ...)
├── lib/                                # api.ts (APIClient), utils, colors, typography, csv, source-evidence helpers
├── hooks/                              # useJobWebSocket, use-toast, ...
├── types/api.ts                        # all request/response types
└── public/                             # static assets (incl. pdf.worker.min.mjs)
```

---

## Architecture

### API layer
All backend calls go through the `APIClient` singleton (`lib/api.ts`):
- Injects the JWT `Authorization` header from `localStorage`
- **Proactive** refresh ~60s before expiry + **reactive** refresh on 401
- On unrecoverable 401, redirects to `/login` — except on public paths (`/`, `/login`, `/register`, `/demo`)

```
Component → Service → APIClient → nginx → Backend API (:8001)
```

### Auth & route guarding
`middleware.ts` gates routes on a lightweight `is_logged_in` cookie (the real JWT stays in `localStorage`; the backend verifies it). `/demo` is public and self-bootstraps its own session.

### State management
| What | How |
|---|---|
| Auth user | `AuthContext` (+ `/auth/me`) |
| Active project | `ProjectContext` |
| Theme (dark/light/system) | `ThemeContext` + pre-hydration blocking script (no flash) |
| Server data | TanStack React Query (stale-time, no refetch on focus) |

### Realtime job logs
`useJobWebSocket` streams live extraction/generation logs from the backend WebSocket (auto-reconnect with backoff), routing `log / progress / stage / complete / error` messages.

---

## Key Conventions

- **Path aliases:** `import { Button } from '@/components/ui/button'` (never deep relative paths).
- **Forms:** React Hook Form + Zod, no uncontrolled inputs.
- **Design:** cool, minimal, breathy UI; reuse `lib/colors.ts` and `lib/typography.ts` rather than hardcoding.
- **Destructive/manage actions:** render only for owners/admins (or matching `can_manage_*` permission).

---

## Pages Overview

| Route | Description |
|---|---|
| `/` · `/login` · `/register` · `/reset-password` | Landing + auth |
| **`/demo`** | Zero-login demo — signs in to a sandboxed demo account, no credentials |
| `/dashboard` | Overview with project switcher, stats, recent extractions |
| `/projects` · `/projects/[id]` | Manage projects; project hub |
| `/documents` | Upload PDFs, processing status, source viewer |
| `/forms` | Build extraction forms + AI (LangGraph) code generation + decomposition review |
| `/extractions` · `/extractions/[id]` | Run and inspect extraction jobs |
| `/results` | Browse, filter, export results |
| `/manual-extraction` | Manual double-review (R1/R2) with per-document queue |
| `/consensus` · `/qa` | Adjudication and QA review |
| `/data-cleaning` · `/vocabularies` | Post-extraction cleanup + controlled vocabularies |
| `/jobs` · `/activity` · `/usage` | Job monitoring, activity feed, usage/cost |
| `/invitations` · `/admin` · `/settings` | Membership, admin, user/app settings |
| `/chat` | Chat with uploaded papers |
