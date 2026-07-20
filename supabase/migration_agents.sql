-- Run this ONCE in Supabase → SQL Editor.
-- Adds agent assignment, status, notes, and a soft-delete flag.

alter table public.listings add column if not exists agent   text;
alter table public.listings add column if not exists status  text default 'New';
alter table public.listings add column if not exists notes   text;
alter table public.listings add column if not exists dismissed boolean not null default false;

-- (The existing "public update seen flags" policy already allows the dashboard
--  to update these fields with the anon key — nothing else needed.)
