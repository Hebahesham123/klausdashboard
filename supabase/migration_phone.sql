-- Run this ONCE in Supabase → SQL Editor.
-- Stores a phone number if the seller wrote one in the listing description.
alter table public.listings add column if not exists phone text;
