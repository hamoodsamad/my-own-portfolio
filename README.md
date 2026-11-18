# Hamood Samad — Portfolio

Interactive scroll-animated portfolio with 48fps optical-flow Full HD frame playback, hover text-recreate effects, responsive layout, Supabase Cloud sync, and a protected Admin Studio (`/admin`).

## Quick Deploy on Vercel
1. Import this repository into [Vercel](https://vercel.com/new).
2. Leave Build Command empty (static + serverless `/api/config.js`) and Output Directory as `.` (root).
3. Add Environment Variables in Vercel Project Settings (optional, overrides defaults):
   - `SUPABASE_URL`
   - `SUPABASE_PUBLISHABLE_KEY`
   - `ADMIN_EMAIL`
4. Deploy.

## Supabase Setup
Run [`supabase-setup.sql`](./supabase-setup.sql) once in your **Supabase Dashboard → SQL Editor** to create/enable Row-Level Security policies for `projects`, `site_profile`, and `inquiries`.
