// One-off: read listing time + mileage for cars that don't have mileage yet.
// Saves progress after every small chunk so it survives interruption.
// Usage: node src/backfill.js
import 'dotenv/config';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { readTimesFor } from './scraper.js';
import { updateTimes, dismissCars } from './supabase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf-8'));
const maxMi = cfg.filters?.wanted?.[0]?.maxMileage ?? null;

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data } = await sb
  .from('listings')
  .select('id, url, title, mileage')
  .eq('dismissed', false)
  .is('is_dealer', null);

if (!data || data.length === 0) {
  console.log('Nothing to backfill.');
  process.exit(0);
}

console.log(`Backfilling mileage for ${data.length} car(s), in chunks of 5...`);
const cars = data.map((r) => ({ id: r.id, url: r.url, title: r.title, mileage: null }));

let done = 0;
let real = 0;
let hidden = 0;
const CHUNK = 5;
for (let i = 0; i < cars.length; i += CHUNK) {
  const chunk = cars.slice(i, i + CHUNK);
  const updated = await readTimesFor(chunk, { headless: true });
  await updateTimes(updated); // <-- saved right away, per chunk
  const over = updated.filter((c) => c.mileageValue != null && maxMi != null && c.mileageValue > maxMi);
  if (over.length > 0) { await dismissCars(over.map((c) => c.id)); hidden += over.length; }
  real += updated.filter((c) => c.mileageValue != null).length;
  done += chunk.length;
  console.log(`  ${done}/${cars.length} checked | ${real} real mileage | ${hidden} hidden (>${maxMi})`);
}
console.log('Backfill complete.');
process.exit(0);
