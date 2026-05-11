# My Workspace — Personal Notion-Style App

A self-hosted Notion alternative for your work, side gig, and personal affairs. Designed to run on Vercel + Neon for **$0/month** for personal use, accessible from your phone, iPad, and laptop as an installable PWA.

## Features

- **Three workspaces** auto-created on signup: Work, Side Gig, Personal (rename freely)
- **Hierarchical pages** with infinite nesting
- **Block-based rich text editor** (TipTap): headings, lists, checkboxes, code, quotes, images, links
- **Auto-save** as you type (800ms debounce)
- **Favorites** for quick access
- **PWA** — installable on iOS, Android, desktop with offline-aware caching
- **Magic-link email auth** (or Google OAuth)
- **Image uploads** to Cloudflare R2

## Stack

| Layer | Tech | Why |
|---|---|---|
| Frontend | Next.js 14 (App Router) + React + Tailwind | One codebase, mobile-friendly |
| Editor | TipTap | Notion-style block editor |
| Backend | Next.js API routes (serverless) | No infra to manage |
| ORM | Prisma | Type-safe queries |
| DB | Neon Postgres | Free tier (0.5 GB), branches |
| Storage | Cloudflare R2 | Free 10 GB, no egress fees |
| Auth | NextAuth.js | Magic links + OAuth |
| Hosting | Vercel | Free Hobby tier |

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Set up Postgres on Neon

1. Sign up at https://neon.tech (free)
2. Create a project, copy the connection string
3. Paste into `.env.local` as `DATABASE_URL`

### 3. Configure auth

**Email magic links** — Sign up at https://resend.com (free 3,000 emails/month):

```
EMAIL_SERVER_HOST=smtp.resend.com
EMAIL_SERVER_PORT=465
EMAIL_SERVER_USER=resend
EMAIL_SERVER_PASSWORD=re_xxxxxxxx
EMAIL_FROM=noreply@yourdomain.com
```

**Google OAuth (optional)** — https://console.cloud.google.com → OAuth consent + credentials.

Generate `NEXTAUTH_SECRET`:

```bash
openssl rand -base64 32
```

### 4. Cloudflare R2 (for image uploads — optional)

1. Cloudflare dashboard → R2 → create bucket
2. Create API token with R2 read/write
3. Enable public bucket access (or use a custom domain)
4. Fill in R2 vars in `.env.local`

### 5. Initialize the database

```bash
npx prisma db push
```

### 6. Run locally

```bash
npm run dev
```

Visit http://localhost:3000

## Deploy to Vercel

```bash
# Push to GitHub first, then:
vercel
```

Add all env vars from `.env.local` in the Vercel project settings. Set `NEXTAUTH_URL` to your production URL.

## Cost Estimate (personal use)

| Service | Tier | Limit | Cost |
|---|---|---|---|
| Vercel Hobby | Free | 100 GB bandwidth | $0 |
| Neon | Free | 0.5 GB storage, 191 hr compute | $0 |
| Cloudflare R2 | Free | 10 GB storage, unlimited egress | $0 |
| Resend | Free | 3k emails/month | $0 |
| **Total** | | | **$0/mo** |

If you outgrow free tiers: Neon Pro ($19/mo), Vercel Pro ($20/mo). Still cheap compared to Notion's paid plans for similar storage.

## Install as App

- **iPhone/iPad:** Open in Safari → Share → "Add to Home Screen"
- **Android:** Chrome → menu → "Install app"
- **Desktop:** Chrome/Edge → install icon in URL bar

## Architecture Notes

- **Single-document model:** Each page stores its TipTap doc as one JSON blob in `Block.content`. Simpler than per-block rows; can migrate to granular blocks later for collab.
- **Fractional positions:** Sibling reordering is O(1) — no batch updates.
- **Cascading deletes:** Deleting a page removes all descendants and blocks.
- **Server components by default:** Auth + data on the server; only editor and sidebar are client components.

## Roadmap Ideas

- Slash command menu (`/heading`, `/todo`)
- Drag-and-drop reordering
- Search (Postgres full-text)
- Templates
- Tags / database views
- End-to-end encryption (per-page key)
- Public sharing with read-only links
