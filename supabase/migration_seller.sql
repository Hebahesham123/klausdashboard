-- Run this ONCE in Supabase → SQL Editor.
-- seller_id:    the Facebook seller's id (so we can count how many CARS each
--               seller has in our data — 3+ cars = a real car dealer).
-- dealer_badge: whether the listing itself showed a dealership/financing badge.
alter table public.listings add column if not exists seller_id text;
alter table public.listings add column if not exists dealer_badge boolean;
