-- ==========================================================
-- Hamood Samad Portfolio — Supabase Schema & RLS Policies
-- Paste this entire file into Supabase Dashboard -> SQL Editor -> Run
-- ==========================================================

-- 1. Projects Table
create table if not exists public.projects (
  id text primary key,
  title text not null,
  category text not null default 'WEB DESIGN',
  description text not null,
  image text not null,
  link text default '',
  created_at timestamptz not null default now()
);

-- 2. Site Profile Table (single row id = 'main')
create table if not exists public.site_profile (
  id text primary key default 'main',
  name text not null,
  role text not null,
  eyebrow text not null,
  quote text not null,
  subtext text not null,
  about_lead text not null,
  email text not null,
  phone text not null,
  location text not null,
  upwork text not null,
  fiverr text not null,
  updated_at timestamptz not null default now()
);

-- 3. Client Inquiries Table
create table if not exists public.inquiries (
  id text primary key,
  name text not null,
  email text not null,
  service text not null default 'Responsive Web Design',
  details text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

-- Enable Row Level Security
alter table public.projects enable row level security;
alter table public.site_profile enable row level security;
alter table public.inquiries enable row level security;

-- Projects Policies: Public can view; Authenticated Admin can insert/update/delete
drop policy if exists "Public read projects" on public.projects;
create policy "Public read projects"
  on public.projects for select
  using (true);

drop policy if exists "Admin manage projects" on public.projects;
create policy "Admin manage projects"
  on public.projects for all
  to authenticated
  using (true)
  with check (true);

-- Site Profile Policies: Public can view; Authenticated Admin can insert/update
drop policy if exists "Public read site_profile" on public.site_profile;
create policy "Public read site_profile"
  on public.site_profile for select
  using (true);

drop policy if exists "Admin manage site_profile" on public.site_profile;
create policy "Admin manage site_profile"
  on public.site_profile for all
  to authenticated
  using (true)
  with check (true);

-- Inquiries Policies: Public can submit; Only Authenticated Admin can read/update/delete
drop policy if exists "Public submit inquiries" on public.inquiries;
create policy "Public submit inquiries"
  on public.inquiries for insert
  with check (true);

drop policy if exists "Admin manage inquiries" on public.inquiries;
create policy "Admin manage inquiries"
  on public.inquiries for select
  to authenticated
  using (true);

drop policy if exists "Admin update inquiries" on public.inquiries;
create policy "Admin update inquiries"
  on public.inquiries for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "Admin delete inquiries" on public.inquiries;
create policy "Admin delete inquiries"
  on public.inquiries for delete
  to authenticated
  using (true);

-- Seed default profile row (safe to re-run)
insert into public.site_profile (
  id, name, role, eyebrow, quote, subtext, about_lead,
  email, phone, location, upwork, fiverr
) values (
  'main',
  'Hamood Samad',
  'Web Designer & Developer',
  'Hey, I''m Hamood Samad',
  E'Great design should\nfeel invisible.',
  'I build modern, high-converting web experiences with clean code that connect and convert.',
  'I''m Hamood Samad, a Web Designer & Developer based in Pakistan focused on building clean, 100% responsive interfaces and maintainable code that solve real-world problems.',
  'hamoodsamad0321@gmail.com',
  '+92 343 6956890',
  'Pakistan • Worldwide',
  'https://www.upwork.com/freelancers/~011602925b19deee69',
  'https://www.fiverr.com/hamood_x03/buying?source=avatar_menu_profile'
)
on conflict (id) do nothing;
