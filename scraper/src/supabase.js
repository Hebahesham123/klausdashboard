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
  const timed = new Set();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('listings')
      .select('id, posted_at')
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const row of data) {
      all.add(row.id);
      if (row.posted_at) timed.add(row.id);
    }
    if (data.length < pageSize) break;
  }
  return { all, timed };
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

/** Write the real listing time onto cars we just read it for. */
export async function updateTimes(cars) {
  for (const c of cars) {
    if (!c.postedAt) continue;
    await supabase
      .from('listings')
      .update({ posted_text: c.postedText, posted_at: c.postedAt })
      .eq('id', c.id);
  }
}
