# eviStream Frontend

Next.js 14 web application for the eviStream AI-powered medical data extraction platform.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 3 |
| UI Primitives | Radix UI |
| Icons | Lucide React |
| HTTP Client | Axios |
| Server State | TanStack React Query 5 |
| Client State | React Context + Zustand |
| Forms | React Hook Form + Zod |
| Real-time | WebSocket (job log streaming) |
| File Upload | react-dropzone |

---

## Getting Started

### Prerequisites

- Node.js 18+
- Backend running on `http://localhost:8000`

### Setup

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.local.example .env.local

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Scripts

```bash
npm run dev       # Development server with hot reload
npm run build     # Production build
npm start         # Start production server
npm run lint      # ESLint
npm run format    # Prettier
```

---

## Environment Variables

```env
# .env.local
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=localhost:8000
```

All API calls are proxied through Next.js rewrites (see `next.config.js`) to avoid CORS issues.

---

## Project Structure

```
frontend/
├── app/
│   ├── layout.tsx                  # Root layout (theme blocking script, fonts)
│   ├── providers.tsx               # React Query + Context providers
│   ├── page.tsx                    # Landing page
│   ├── globals.css                 # Global styles + animations
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── register/page.tsx
│   └── (dashboard)/
│       ├── dashboard/page.tsx      # Main dashboard with project switcher
│       ├── projects/page.tsx       # Project management
│       ├── projects/[id]/page.tsx  # Project detail
│       ├── documents/page.tsx      # Document upload & management
│       ├── forms/page.tsx          # Form creation + AI code generation
│       ├── extractions/page.tsx    # Run extraction jobs
│       ├── manual-extraction/      # Manual data extraction
│       ├── results/page.tsx        # View & export results
│       ├── jobs/page.tsx           # Job monitoring
│       ├── activity/page.tsx       # Activity feed
│       ├── chat/page.tsx           # Paper chat (ask documents)
│       ├── consensus/page.tsx      # Consensus review
│       └── settings/page.tsx
│
├── components/
│   ├── layout/
│   │   ├── dashboard-layout.tsx    # Main layout wrapper
│   │   ├── sidebar.tsx             # Collapsible nav sidebar (collapsed by default)
│   │   ├── navbar.tsx              # Top navigation bar
│   │   └── notification-center.tsx # Notifications panel
│   ├── ui/                         # Radix-based primitives
│   │   ├── button.tsx
│   │   ├── input.tsx, textarea.tsx, select.tsx, label.tsx
│   │   ├── card.tsx, dialog.tsx, badge.tsx
│   │   ├── progress.tsx, spinner.tsx, skeleton.tsx
│   │   ├── toast.tsx, toaster.tsx, alert.tsx
│   │   ├── file-dropzone.tsx
│   │   ├── stats-card.tsx, sparkline.tsx
│   │   ├── empty-state.tsx, confirmation-dialog.tsx
│   │   └── logo.tsx
│   ├── animated/                   # Animation-heavy components
│   ├── chat/                       # Chat interface components
│   └── features/                   # Feature-specific components
│
├── services/                       # API abstraction layer
│   ├── auth.service.ts
│   ├── projects.service.ts
│   ├── documents.service.ts
│   ├── forms.service.ts
│   ├── extractions.service.ts
│   ├── results.service.ts
│   ├── jobs.service.ts
│   ├── activity.service.ts
│   ├── notifications.service.ts
│   ├── jobLogsWebSocket.ts         # WebSocket with auto-reconnect
│   └── index.ts
│
├── contexts/
│   ├── ProjectContext.tsx           # Active project state + CRUD
│   └── ThemeContext.tsx             # Dark/light/system theme
│
├── hooks/
│   ├── useJobWebSocket.ts           # Real-time job log streaming
│   ├── useScrollReveal.ts
│   ├── useParallax.ts
│   ├── useMousePosition.ts
│   └── use-toast.ts
│
├── lib/
│   ├── api.ts                       # Axios APIClient singleton
│   ├── utils.ts                     # cn(), formatDate(), etc.
│   ├── colors.ts                    # Status color mappings
│   └── typography.ts                # Semantic typography classes
│
├── types/
│   └── api.ts                       # All API request/response types
│
└── public/
    └── landing-preview.html         # Static landing page asset
```

---

## Architecture

### API Layer

All backend communication goes through the `APIClient` singleton (`lib/api.ts`):

- Automatic JWT Bearer token injection from localStorage
- 401 interceptor auto-redirects to `/login`
- All service files import from `APIClient` — no direct `fetch`/`axios` calls in components

```
Component → Service → APIClient → Backend API (:8000)
```

### State Management

| What | How |
|---|---|
| Active project | `ProjectContext` (React Context + localStorage fallback) |
| Theme (dark/light) | `ThemeContext` (React Context + localStorage + system preference) |
| Server data | TanStack React Query (1min stale time, no refetch on focus) |
| Local UI state | `useState` / `useReducer` in components |

### Dark Mode

- `ThemeContext` adds/removes `dark` class on `<html>`
- A blocking `<script>` in `layout.tsx` applies the saved theme before React hydrates, preventing flash
- Tailwind uses `darkMode: 'class'` strategy

### Real-time Job Logs

`JobLogsWebSocket` (`services/jobLogsWebSocket.ts`) connects to the backend WebSocket endpoint and streams live logs during extraction/generation jobs:

- Auto-reconnection with exponential backoff (5 attempts)
- Message type routing: `log`, `progress`, `stage`, `data`, `complete`, `error`
- Consumed via `useJobWebSocket` hook in pages

### Form Generation Flow

1. User defines a form (fields, sections) in `/forms`
2. `formsService.create()` submits definition to backend
3. Backend starts async AI code generation job
4. Frontend connects WebSocket to stream live generation logs
5. On completion, user can review and approve/reject the AI decomposition
6. Approved form is registered as a schema ready for extraction

---

## Key Conventions

**Path aliases** — use `@/` instead of relative imports:
```ts
import { Button } from '@/components/ui/button';
import { projectsService } from '@/services';
```

**Colors** — always use `lib/colors.ts` for status colors, never hardcode:
```ts
import { statusColor, statusBg } from '@/lib/colors';
```

**Typography** — use semantic classes from `lib/typography.ts`:
```ts
import { typography } from '@/lib/typography';
<h1 className={typography.page.title}>...</h1>
```

**Forms** — React Hook Form + Zod always, no uncontrolled inputs:
```ts
const schema = z.object({ name: z.string().min(1) });
const { register, handleSubmit } = useForm({ resolver: zodResolver(schema) });
```

---

## Pages Overview

| Route | Description |
|---|---|
| `/` | Landing page |
| `/login` | Authentication |
| `/register` | Account creation |
| `/dashboard` | Overview with project switcher, stats, recent extractions |
| `/projects` | List and manage projects |
| `/documents` | Upload PDFs, view processing status |
| `/forms` | Create extraction forms, trigger AI code generation |
| `/extractions` | Run extraction jobs against uploaded documents |
| `/results` | Browse, filter, and export extraction results |
| `/manual-extraction` | Manually fill in extraction fields |
| `/consensus` | Review and reconcile AI vs manual extractions |
| `/jobs` | Monitor all async jobs |
| `/activity` | Full activity feed |
| `/chat` | Chat with uploaded papers |
| `/settings` | User and app settings |
