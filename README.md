# ZL Business Solutions

A multi-branch business operations webapp — invoicing, inventory, accounts receivable, expenses, and bank reconciliation — built as a portfolio project.

> Demo build. Data is illustrative only.

**Demo login:** `demo@zlbs.app` / `ZLdemo2026!` (or click **Use demo account** on the sign-in screen).

## Stack

- **Frontend:** React 19 + Vite
- **Styling:** Tailwind CSS v4
- **Backend / DB:** Supabase (Postgres + RLS)
- **Hosting:** Vercel
- **Routing:** React Router

## Features

- Customer, item, and purchase-order management
- Batch-number-based inventory across multiple storage locations, with transfers and adjustments
- Invoicing with per-line warehouse allocation and multiple sale types
- Accounts receivable: partial payments, payment modes, deposit slips
- Expense tracking by category
- Executive summary / KPI dashboard
- Audit log, soft delete + recycle bin
- PWA (installable, offline shell) with responsive navigation and dark mode

## Local development

```bash
npm install
cp .env.example .env.local   # then fill in your Supabase credentials
npm run dev
```

## Environment variables

| Variable | Description |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anonymous (public) key |

## Database

SQL migrations live in [`supabase/migrations/`](supabase/migrations) and are applied in numerical order against a fresh Supabase project.

## Build

```bash
npm run build    # outputs to dist/
npm run preview  # preview the production build locally
```
