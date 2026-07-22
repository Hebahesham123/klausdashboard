import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { scrapeGrids, readTimesFor } from './scraper.js';
import { keepCar } from './filters.js';
import { getExistingIds, saveCars, updateTimes, dismissCars, recomputeDealers } from './supabase.js';
import { sendNewCarsEmail } from './email.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function loadConfig() {
  const raw = fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf-8');
  return JSON.parse(raw);
}

/**
 * One cycle:
 *  1. Grid scrape → save immediately so new cars appear on the dashboard NOW
 *     (showing "reading time…" until their page is read).
 *  2. Read pages for unchecked cars — BRAND-NEW first — to fill in the real
 *     "Listed X ago" + mileage, and hide any over the mileage limit.
 */
export async function runOnce() {
  const config = loadConfig();
  const headless = process.env.HEADLESS !== 'false';
  const cap = config.maxDetailFetchesPerRun ?? 30;

  console.log(`[${new Date().toLocaleTimeString()}] Scraping ${config.searches.length} searches...`);

  const { all: existingIds, checked: checkedIds } = await getExistingIds();

  const grid = await scrapeGrids(config, { headless });
  const kept = grid.filter((c) => keepCar(c, config.filters));
  console.log(`  ${grid.length} scraped, ${kept.length} match your filters.`);

  // 1) SAVE NOW — cars appear immediately (real time fills in next).
  const newCars = await saveCars(kept, existingIds);
  if (newCars.length > 0) console.log(`  🚗 ${newCars.length} new car(s) added — reading their FB times...`);

  // 2) Read pages for unchecked cars, brand-new ones first.
  // Read order: Facebook "Just listed" first, then brand-new, then the rest —
  // so the freshest cars get their real time + dealer check the soonest.
  const prio = (c) => (c.justListed ? 0 : 2) + (existingIds.has(c.id) ? 1 : 0);
  const needTime = config.readDetails === false
    ? []
    : kept
        .filter((c) => !checkedIds.has(c.id))
        .sort((a, b) => prio(a) - prio(b))
        .slice(0, cap);
  if (needTime.length > 0) {
    console.log(`  Reading FB time + mileage + seller for ${needTime.length} car(s)...`);
    const timed = await readTimesFor(needTime, { headless, concurrency: config.readConcurrency ?? 5 });
    await updateTimes(timed);
    // Hide ONLY cars that are over the mileage limit — i.e. they'd pass every
    // filter if we ignored mileage, but fail once the real mileage is known.
    // (Never hide for city/price/year/keyword reasons.)
    const over = timed.filter(
      (c) =>
        c.mileageValue != null &&
        keepCar({ ...c, mileageValue: null }, config.filters) &&
        !keepCar(c, config.filters)
    );
    if (over.length > 0) {
      await dismissCars(over.map((c) => c.id));
      console.log(`  Hid ${over.length} car(s) over the mileage limit.`);
    }
  }

  // Re-decide dealers from car-counts-per-seller (only counts cars in our DB).
  const dc = await recomputeDealers(config.dealerMinListings ?? 3);
  console.log(`  Dealers: ${dc.dealers} | private: ${dc.privates}`);

  if (newCars.length > 0) await sendNewCarsEmail(newCars);
  else console.log('  No new cars this run.');
  return newCars.length;
}
