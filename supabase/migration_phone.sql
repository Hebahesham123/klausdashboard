-- Run this ONCE in Supabase → SQL Editor.
-- phone:   stores a phone number if the seller wrote one in the description.
-- removed: your MANUAL removals (the ✕ button). Nothing auto-reverses this,
--          so cars you remove by hand never come back.
alter table public.listings add column if not exists phone text;
alter table public.listings add column if not exists removed boolean not null default false;
