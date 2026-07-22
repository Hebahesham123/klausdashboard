import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in scraper/.env');
  process.exit(1);
}

export const supabase = createClient(url, key, {
  auth: { persistSession: false },
});

/**
 * Return two Sets:
 *  - all: every listing id we've stored
 *  - timed: ids that already have a real FB listing time (posted_at)
 */
export async function getExistingIds() {
  const all = new Set();
  const checked = new Set(); // cars whose detail page we've read (dealer_badge set)
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('listings')
      .select('id, dealer_badge')
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const row of data) {
      all.add(row.id);
      if (row.dealer_badge != null) checked.add(row.id);
    }
    if (data.length < pageSize) break;
  }
  return { all, checked };
}

/**
 * Upsert scraped cars. Returns the array of cars that were brand new
 * (not previously in the table) so the caller can email about them.
 */
export async function saveCars(cars, existingIds) {
  const now = new Date().toISOString();

  // A listing can appear in more than one city's search (cars near a border).
  // Dedupe by id so a single upsert never contains the same id twice.
  const byId = new Map();
  for (const c of cars) if (!byId.has(c.id)) byId.set(c.id, c);
  cars = Array.from(byId.values());

  const newCars = cars.filter((c) => !existingIds.has(c.id));

  // Insert brand-new cars (is_new = true).
  if (newCars.length > 0) {
    const rows = newCars.map((c) => ({
      id: c.id,
      title: c.title,
      price_value: c.priceValue,
      price_text: c.priceText,
      city: c.city,
      mileage: c.mileage,
      image_url: c.imageUrl,
      url: c.url,
      posted_text: c.postedText,
      posted_at: c.postedAt,
      phone: c.phone ?? null,
      seller_id: c.sellerId ?? null,
      dealer_badge: c.dealerBadge ?? null,
      first_seen: now,
      last_seen: now,
      is_new: true,
      acknowledged: false,
    }));
    const { error } = await supabase.from('listings').upsert(rows, { onConflict: 'id' });
    if (error) throw error;
  }

  // Touch last_seen on cars we've seen before (still live).
  const seenAgain = cars.filter((c) => existingIds.has(c.id)).map((c) => c.id);
  if (seenAgain.length > 0) {
    const { error } = await supabase
      .from('listings')
      .update({ last_seen: now })
      .in('id', seenAgain);
    if (error) throw error;
  }

  return newCars;
}

/** Hide cars (soft delete) — e.g. ones found to exceed the mileage limit. Not truly removed. */
export async function dismissCars(ids) {
  if (!ids || ids.length === 0) return;
  await supabase.from('listings').update({ dismissed: true }).in('id', ids);
}

/** Write the real listing time, mileage, seller id, dealer badge, and phone. */
export async function updateTimes(cars) {
  for (const c of cars) {
    const patch = { mileage: c.mileage || 'Not listed' }; // always mark as checked
    if (c.postedAt) { patch.posted_text = c.postedText; patch.posted_at = c.postedAt; }
    if (c.dealerBadge != null) patch.dealer_badge = c.dealerBadge;
    if (c.sellerId) patch.seller_id = c.sellerId;
    if (c.phone) patch.phone = c.phone;
    await supabase.from('listings').update(patch).eq('id', c.id);
  }
}

/**
 * Decide who's a car dealer: a seller with >= minCars CARS in our data (our
 * whole DB is cars, so this never miscounts furniture/phones), OR any listing
 * that itself shows a dealership/financing badge. Updates is_dealer on every
 * car we've already read. Cheap: a couple of full-table scans + batched updates.
 */
export async function recomputeDealers(minCars = 3) {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('listings')
      .select('id, seller_id, dealer_badge')
      .eq('removed', false)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
  }

  // Count cars per seller (only reads with a seller id count).
  const counts = new Map();
  for (const r of rows) {
    if (r.seller_id) counts.set(r.seller_id, (counts.get(r.seller_id) || 0) + 1);
  }

  // Compute is_dealer only for cars we've actually read (dealer_badge set).
  const wantDealer = [];
  const wantPrivate = [];
  for (const r of rows) {
    if (r.dealer_badge == null) continue; // not read yet — leave as-is
    const isDealer = r.dealer_badge === true || (r.seller_id && counts.get(r.seller_id) >= minCars);
    (isDealer ? wantDealer : wantPrivate).push(r.id);
  }

  for (let i = 0; i < wantDealer.length; i += 500)
    await supabase.from('listings').update({ is_dealer: true }).in('id', wantDealer.slice(i, i + 500));
  for (let i = 0; i < wantPrivate.length; i += 500)
    await supabase.from('listings').update({ is_dealer: false }).in('id', wantPrivate.slice(i, i + 500));

  return { dealers: wantDealer.length, privates: wantPrivate.length };
}
