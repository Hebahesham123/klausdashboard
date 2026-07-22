-- Run this ONCE in Supabase → SQL Editor.
-- marked_dealer: you tagged this seller as a dealer by hand. Sticky — every car
-- from that seller (now and future) stays hidden from the Private view.
alter table public.listings add column if not exists marked_dealer boolean not null default false;
