-- ============================================================
--  GAD Marketplace Dashboard — Supabase schema
--  Run this in Supabase → SQL Editor (once).
-- ============================================================

create table if not exists public.listings (
  id           text primary key,          -- Facebook item id (from the listing URL)
  title        text,
  price_value  integer,                    -- numeric price for sorting/filtering (nullable)
  price_text   text,                       -- e.g. "$8,500"
  city         text,                       -- Bellflower / Montclair / Fontana
  mileage      text,                       -- e.g. "84K miles" (as shown by FB)
  image_url    text,
  url          text not null,              -- full facebook listing link (clickable)
  posted_text  text,                       -- Facebook's real "Listed X ago" text
  posted_at    timestamptz,                -- approx. real listing time parsed from posted_text
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  is_new       boolean not null default true,   -- highlighted with a NEW badge
  acknowledged boolean not null default false    -- set true when you click "Mark all seen"
);

create index if not exists listings_first_seen_idx on public.listings (first_seen desc);
create index if not exists listings_city_idx on public.listings (city);

-- ------------------------------------------------------------
--  Row Level Security
--  - The Next.js dashboard uses the ANON key: read-only.
--  - The scraper uses the SERVICE ROLE key: bypasses RLS, can write.
-- ------------------------------------------------------------
alter table public.listings enable row level security;

drop policy if exists "public read listings" on public.listings;
create policy "public read listings"
  on public.listings for select
  using (true);

-- Allow the dashboard to flip is_new/acknowledged (mark as seen) with the anon key.
drop policy if exists "public update seen flags" on public.listings;
create policy "public update seen flags"
  on public.listings for update
  using (true)
  with check (true);

-- ------------------------------------------------------------
--  Realtime: let the dashboard receive live inserts/updates.
-- ------------------------------------------------------------
alter publication supabase_realtime add table public.listings;
