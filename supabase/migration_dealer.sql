-- Run this ONCE in Supabase → SQL Editor.
-- Flags whether a listing is from a dealership (vs a private seller).
alter table public.listings add column if not exists is_dealer boolean;
