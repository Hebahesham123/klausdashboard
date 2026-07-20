-- Run this ONCE in Supabase → SQL Editor.
-- Adds Facebook's real listing time, and clears the old rows that had
-- misleading "found" times so the dashboard starts clean.

alter table public.listings add column if not exists posted_text text;
alter table public.listings add column if not exists posted_at timestamptz;

-- Wipe the old seed rows (they were saved before we tracked real listing time).
delete from public.listings;
