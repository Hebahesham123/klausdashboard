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
 *  1. Fast grid scrape → save immediately so cars appear on the dashboard NOW.
 *  2. Slow pass → open matching cars' pages to read the real "Listed X ago",
 *     newest first, and update them (dashboard fills the times in live).
 */
export async function runOnce() {
  const config = loadConfig();
  const headless = process.env.HEADLESS !== 'false';

  console.log(`[${new Date().toLocaleTimeString()}] Scraping ${config.searches.length} searches...`);

  const { all: existingIds, checked: checkedIds } = await getExistingIds();

  // 1) FAST: grid scrape + save right away.
  const grid = await scrapeGrids(config, { headless });
  const kept = grid.filter((c) => keepCar(c, config.filters));
  console.log(`  ${grid.length} scraped, ${kept.length} match your filters.`);

  const newCars = await saveCars(kept, existingIds); // <-- cars visible on dashboard here
  if (newCars.length > 0) {
    console.log(`  🚗 ${newCars.length} new car(s) added — now reading their FB times...`);
  }

  // 2) SLOW: read real listing time for matching cars that don't have one yet,
  //    newest first (fresh-pass cars come first in the scrape order).
  const cap = config.maxDetailFetchesPerRun ?? 30;
  const needTime = kept.filter((c) => !checkedIds.has(c.id)).slice(0, cap);
  if (needTime.length > 0) {
    console.log(`  Reading listing time + mileage for ${needTime.length} car(s)...`);
    const timed = await readTimesFor(needTime, { headless });
    await updateTimes(timed);
    console.log(`  Filled in ${timed.length} listing time(s).`);

    // Now that mileage is known for these, hide any that fail the filters
    // (e.g. mileage over the 120k limit). Hidden, not deleted.
    const nowFailing = timed.filter((c) => c.mileageValue != null && !keepCar(c, config.filters));
    if (nowFailing.length > 0) {
      await dismissCars(nowFailing.map((c) => c.id));
      console.log(`  Hid ${nowFailing.length} car(s) over the mileage limit.`);
    }
  }

  // Email the new cars (now carrying their real times where available).
  if (newCars.length > 0) {
    for (const c of newCars) console.log(`     - ${c.priceText || ''} ${c.title || ''} (${c.city}) — ${c.postedText || 'time pending'}`);
    await sendNewCarsEmail(newCars);
  } else {
    console.log('  No new cars this run.');
  }
  return newCars.length;
}
