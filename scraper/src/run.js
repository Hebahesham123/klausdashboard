import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { scrapeGrids, readTimesFor } from './scraper.js';
import { keepCar } from './filters.js';
import { getExistingIds, saveCars, updateTimes, dismissCars } from './supabase.js';
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
  const needTime = config.readDetails === false
    ? []
    : kept
        .filter((c) => !checkedIds.has(c.id))
        .sort((a, b) => (existingIds.has(a.id) ? 1 : 0) - (existingIds.has(b.id) ? 1 : 0))
        .slice(0, cap);
  if (needTime.length > 0) {
    console.log(`  Reading FB time + mileage + seller for ${needTime.length} car(s)...`);
    const timed = await readTimesFor(needTime, { headless, dealerMinListings: config.dealerMinListings ?? 3, concurrency: config.readConcurrency ?? 3 });
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

  if (newCars.length > 0) await sendNewCarsEmail(newCars);
  else console.log('  No new cars this run.');
  return newCars.length;
}
