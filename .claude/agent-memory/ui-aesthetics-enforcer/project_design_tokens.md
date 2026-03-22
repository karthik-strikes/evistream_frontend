---
name: eviStream Dashboard Design Tokens
description: Authoritative Tailwind class patterns extracted from forms and documents reference pages for dashboard aesthetic enforcement
type: project
---

## Card / Container

- Card shell: `rounded-xl border border-gray-200 dark:border-[#1f1f1f] overflow-hidden bg-white dark:bg-[#111111] mb-5`
- Card header (with title): `px-5 py-4 border-b border-gray-100 dark:border-[#1f1f1f]`
- Card header title: `text-sm font-semibold text-gray-900 dark:text-white`
- Card header description: `text-xs text-gray-400 dark:text-zinc-500 mt-0.5`

## Row (SettingRow pattern — used in settings AND admin pages)

- Row wrapper: `flex items-start justify-between gap-6 px-5 py-4` + `border-b border-gray-100 dark:border-[#1f1f1f]` (omit on last row via `last` prop)
- Label: `text-sm font-medium text-gray-900 dark:text-white`
- Sub-label/description: `text-xs text-gray-400 dark:text-zinc-500 mt-0.5 leading-relaxed`
- Left wrapper: `flex-1 min-w-0 pt-0.5`
- Right wrapper: `flex-shrink-0`

## List Items (document card style)

- Item shell: `group bg-white rounded-xl border py-5 px-[22px] relative transition-all duration-150 hover:shadow-card-hover hover:-translate-y-px dark:bg-[#111111]`
- Selected border: `border-gray-400 dark:border-[#3f3f3f]`
- Default border: `border-border dark:border-[#1f1f1f]`

## Typography

- Page section heading (internal h2): `text-base font-semibold text-gray-900 dark:text-white`
- Section group label (nav group): `text-[10px] font-semibold text-gray-300 dark:text-zinc-700 uppercase tracking-widest px-2 mb-1`
- Item filename/title: `text-base font-semibold text-gray-900 dark:text-white tracking-tight`
- Body secondary: `text-sm text-gray-500 dark:text-zinc-400`
- Tiny/count: `text-xs text-gray-400 dark:text-zinc-500`

## Buttons

- Primary (dark): `text-sm font-semibold text-white bg-gray-900 dark:bg-white dark:text-black border-none rounded-lg px-4 py-2 cursor-pointer flex items-center gap-1.5 hover:bg-gray-700 dark:hover:bg-zinc-100 transition-colors`
- Ghost action: `inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-zinc-400 bg-transparent border-none px-3 py-1.5 rounded-lg cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-[#1a1a1a]`
- Destructive action: `inline-flex items-center gap-1.5 text-xs font-medium text-error-600 bg-transparent border-none px-3 py-1.5 rounded-lg cursor-pointer transition-colors hover:bg-error-50`
- Destructive badge button (bulk delete): `inline-flex items-center gap-1.5 text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 px-3 py-1 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors disabled:opacity-50`
- Pagination: `text-xs px-3 py-1.5 border border-gray-200 dark:border-[#2a2a2a] rounded-lg disabled:opacity-40 text-gray-600 dark:text-zinc-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a] transition-colors`

## Status Badges (inline span/button)

- Completed/Active: `bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400 border border-green-200 dark:border-green-800/50`
- Processing/In-progress: `bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400 border border-blue-200 dark:border-blue-800/50`
- Failed/Inactive: `bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400 border border-red-200 dark:border-red-800/50`
- Pending/neutral: `bg-gray-100 text-gray-600 dark:bg-[#1a1a1a] dark:text-zinc-400 border border-gray-200 dark:border-[#2a2a2a]`
- Badge font/shape: `text-[10.5px] font-semibold px-2 py-0.5 rounded-[5px] tracking-wide whitespace-nowrap`

## Inputs & Selects

- Input: `w-full px-3 py-1.5 text-sm text-gray-900 dark:text-white bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-[#2a2a2a] rounded-lg outline-none focus:border-gray-400 dark:focus:border-[#3f3f3f] transition-colors placeholder:text-gray-300 dark:placeholder:text-zinc-600`
- Select: inputCls + `cursor-pointer dark:[color-scheme:dark]`
- Search input: `text-sm text-gray-900 dark:text-white bg-white dark:bg-[#111111] border border-gray-200 dark:border-[#1f1f1f] rounded-lg py-1.5 pl-9 pr-3 outline-none focus:border-gray-400 dark:focus:border-[#3f3f3f] placeholder:text-gray-400 w-64`

## Loading States

- Full-page guard loader: `<div className="flex items-center justify-center h-48"><Loader2 className="w-5 h-5 animate-spin text-gray-300 dark:text-zinc-600" /></div>`
- Section/card loader: same Loader2 pattern, wrapped in `flex items-center justify-center p-8`
- List loader: `<div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-gray-400" /></div>` (documents style, larger icon)
- NEVER use plain text "Loading..." — always use Loader2 spinner

## Sidebar Nav Layout (settings/admin pattern)

- Outer wrapper: `max-w-5xl mx-auto flex gap-0 pt-10`
- Left nav: `w-48 flex-shrink-0 flex flex-col pr-8 overflow-y-auto`
- Nav identity block: `mb-5 pb-5 border-b border-gray-100 dark:border-[#1f1f1f]`
- Nav active item: `bg-gray-100 dark:bg-[#1f1f1f] text-gray-900 dark:text-white font-medium`
- Nav inactive item: `text-gray-500 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300 hover:bg-gray-50 dark:hover:bg-[#1a1a1a]`
- Nav item common: `w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-sm transition-colors text-left`
- Nav icon: `w-3.5 h-3.5 flex-shrink-0`
- Content panel: `flex-1 min-w-0 overflow-y-auto pl-8`
- Section heading: `flex items-center justify-between mb-6` > `h2 text-base font-semibold text-gray-900 dark:text-white`

## Table

- Table thead bg: `bg-gray-50 dark:bg-[#0d0d0d]`
- Table th: `text-left px-5 py-2.5 text-xs font-medium text-gray-500 dark:text-zinc-500`
- Table tbody divider: `divide-y divide-gray-100 dark:divide-[#1f1f1f]`
- Table row hover: `hover:bg-gray-50 dark:hover:bg-[#0d0d0d]`
- Table td primary: `px-5 py-3.5 text-sm text-gray-900 dark:text-zinc-200`
- Table td secondary: `px-5 py-3.5 text-sm text-gray-500 dark:text-zinc-400`
- Table td tiny: `px-5 py-3.5 text-gray-400 dark:text-zinc-500 text-xs`

## Tags / Labels

- Label chip: `inline-flex items-center text-[11px] font-medium bg-gray-100 dark:bg-[#1f1f1f] text-gray-500 dark:text-gray-400 px-2 py-0.5 rounded-full`

## Tab Bar (segmented control pattern — used in project hub sections)

- Tab container: `flex gap-1 mb-6 bg-gray-100 dark:bg-[#1a1a1a] p-1 rounded-lg w-fit`
- Active tab: `bg-white dark:bg-[#2a2a2a] text-gray-900 dark:text-white shadow-sm`
- Inactive tab: `text-gray-500 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-300`
- Tab common: `flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors`

## Section Sub-heading (dot-header pattern — used inside sections/cards)

- Dot marker + label wrapper: `flex items-center gap-2 mb-3`
- Dot: `w-1.5 h-1.5 rounded-full bg-gray-900 dark:bg-white` (or colored e.g. `bg-blue-600` for semantic groupings)
- Label: `text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-500`

## Dark mode text scale (canonical zinc tokens, NOT gray)

- Primary text: `dark:text-white`
- Secondary body: `dark:text-zinc-400`  (NOT `dark:text-gray-400`)
- Tertiary/muted: `dark:text-zinc-500`  (NOT `dark:text-gray-500`)
- Tiny/count: `dark:text-zinc-500` or `dark:text-zinc-600`
- Icon placeholder: `dark:text-zinc-600`
- NOTE: `dark:text-gray-*` inside this project is non-standard — always convert to `dark:text-zinc-*`

## Icon sizes

- Action icons: `w-3.5 h-3.5` (in buttons)
- List icons: `h-4 w-4`
- Large empty state icons: `h-16 w-16 text-gray-300`
- Medium alert icons: `h-12 w-12`

## Dark mode background scale

- Page bg: controlled by DashboardLayout (not set directly on pages)
- Cards/containers: `dark:bg-[#111111]`
- Elevated rows / staging: `dark:bg-[#161616]`
- Input backgrounds: `dark:bg-[#1a1a1a]`
- Subtle borders: `dark:border-[#1f1f1f]`
- Dividers: `dark:divide-[#1f1f1f]`
- Label chips: `dark:bg-[#1f1f1f]`
- Hover on inputs/rows: `dark:bg-[#1a1a1a]` or `dark:bg-[#0d0d0d]`
- Border hover/selected: `dark:border-[#3f3f3f]`

## Layout wrapper (DashboardLayout usage)

- Pages with full custom internal layout (settings, admin): `<DashboardLayout>` with no title/description props
- Pages with a content header rendered by DashboardLayout (forms, documents): `<DashboardLayout title="..." description="...">`
- Content spacing: outer div uses `space-y-6`

**Why:** Extracted from forms/page.tsx and documents/page.tsx as the canonical reference pages per the UI consistency enforcement mandate.
**How to apply:** Any new `(dashboard)/` page must use these exact class combinations. Cross-check against this list before declaring a page consistent.
