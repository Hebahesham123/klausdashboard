import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { parsePrice, parseMileage, parseYear, keepCar } from './filters.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_FILE = path.join(__dirname, '..', 'data', 'fb-session.json');

export function hasSession() {
  return fs.existsSync(SESSION_FILE);
}
export const SESSION_PATH = SESSION_FILE;

async function autoScroll(page, rounds = 12) {
  for (let i = 0; i < rounds; i++) {
    await page.mouse.wheel(0, 2400);
    await page.waitForTimeout(1100 + Math.floor(Math.random() * 700));
  }
}

/**
 * Turn Facebook's "Listed X ago" phrase into an approximate ISO timestamp.
 * Returns { text, at } where `at` may be null if we couldn't parse it.
 */
export function parseListed(text) {
  if (!text) return { text: null, at: null };
  const clean = text.replace(/\s+/g, ' ').trim();
  const t = clean.toLowerCase();
  const now = Date.now();
  const MIN = 60000, HR = 3600000, DAY = 86400000, WK = 7 * DAY, MO = 30 * DAY;
  const num = (s) => (/\d/.test(s) ? parseInt(s, 10) : 1); // "a"/"an" => 1

  let m;
  if (/just now|few seconds|moment/.test(t)) return { text: clean, at: new Date(now).toISOString() };
  if ((m = t.match(/(\d+|a|an)\s*minute/))) return { text: clean, at: new Date(now - num(m[1]) * MIN).toISOString() };
  if ((m = t.match(/(\d+|an|a)\s*hour/)))   return { text: clean, at: new Date(now - num(m[1]) * HR).toISOString() };
  if (/yesterday/.test(t))                  return { text: clean, at: new Date(now - DAY).toISOString() };
  if ((m = t.match(/(\d+|a|an)\s*day/)))    return { text: clean, at: new Date(now - num(m[1]) * DAY).toISOString() };
  if ((m = t.match(/(\d+|a|an)\s*week/)))   return { text: clean, at: new Date(now - num(m[1]) * WK).toISOString() };
  if ((m = t.match(/(\d+|a|an)\s*month/)))  return { text: clean, at: new Date(now - num(m[1]) * MO).toISOString() };
  return { text: clean, at: null };
}

/** Read the "Listed X ago ..." line from a listing detail page. */
async function fetchListedText(context, url) {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500 + Math.random() * 1000);
    const txt = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('span, div, abbr'));
      for (const el of nodes) {
        const s = (el.textContent || '').trim();
        if (/^listed\s+/i.test(s) && s.length < 80) return s;
      }
      return null;
    });
    return txt;
  } catch {
    return null;
  } finally {
    await page.close();
  }
}

async function scrapeCity(context, search) {
  const page = await context.newPage();
  const cars = [];
  try {
    await page.goto(search.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(3500);

    if (page.url().includes('/login') || (await page.locator('input[name="email"]').count()) > 0) {
      throw new Error('Not logged in — run `npm run login` again to refresh the Facebook session.');
    }

    await autoScroll(page);

    const raw = await page.evaluate(() => {
      const out = [];
      const anchors = Array.from(document.querySelectorAll('a[href*="/marketplace/item/"]'));
      for (const a of anchors) {
        const href = a.getAttribute('href') || '';
        const idMatch = href.match(/\/marketplace\/item\/(\d+)/);
        if (!idMatch) continue;
        const lines = (a.innerText || '').split('\n').map((s) => s.trim()).filter(Boolean);
        const img = a.querySelector('img');
        out.push({ id: idMatch[1], lines, imageUrl: img ? img.getAttribute('src') : null });
      }
      return out;
    });

    const seen = new Set();
    for (const r of raw) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);

      const priceLine = r.lines.find((l) => /\$\s?\d/.test(l)) || null;
      const mileageLine = r.lines.find((l) => /miles?/i.test(l)) || null;
      // "Los Angeles, CA" style location line (may have trailing FB badge text)
      const cityLine = r.lines.find((l) => /^[A-Za-z][A-Za-z .'-]+,\s*[A-Z]{2}\b/.test(l)) || null;
      const cityClean = cityLine ? (cityLine.match(/^([A-Za-z][A-Za-z .'-]+,\s*[A-Z]{2})/) || [])[1] || null : null;
      const candidates = r.lines.filter((l) => l !== priceLine && l !== mileageLine && l !== cityLine);
      const titleLine =
        candidates.find((l) => /\b(19[8-9]\d|20[0-4]\d)\b/.test(l)) ||
        candidates.sort((a, b) => b.length - a.length)[0] ||
        null;

      cars.push({
        id: r.id,
        title: titleLine,
        priceText: priceLine,
        priceValue: parsePrice(priceLine),
        mileage: mileageLine,
        mileageValue: parseMileage(mileageLine),
        year: parseYear(titleLine),
        city: cityClean || search.city,
        imageUrl: r.imageUrl,
        url: `https://www.facebook.com/marketplace/item/${r.id}/`,
        postedText: null,
        postedAt: null,
      });
    }
  } finally {
    await page.close();
  }
  return cars;
}

async function withContext(headless, fn) {
  if (!hasSession()) throw new Error('No Facebook session found. Run `npm run login` first.');
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    storageState: SESSION_FILE,
    viewport: { width: 1366, height: 900 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  });
  try {
    return await fn(context);
  } finally {
    await context.close();
    await browser.close();
  }
}

/**
 * FAST pass: scrape every city's grid and return the deduped cars (no listing
 * time yet). This is quick, so cars can be saved and shown immediately.
 */
export async function scrapeGrids(config, { headless = true } = {}) {
  return withContext(headless, async (context) => {
    const all = [];
    for (const search of config.searches) {
      try {
        const cars = await scrapeCity(context, search);
        const limited = config.maxCarsPerCity > 0 ? cars.slice(0, config.maxCarsPerCity) : cars;
        all.push(...limited);
        console.log(`  ${search.city}: found ${limited.length} listings`);
      } catch (err) {
        console.error(`  ${search.city}: ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, 2000 + Math.random() * 2000));
    }
    const byId = new Map();
    for (const c of all) if (!byId.has(c.id)) byId.set(c.id, c);
    return Array.from(byId.values());
  });
}

/**
 * SLOW pass: open each given car's page to read Facebook's real "Listed X ago".
 * Mutates each car (postedText/postedAt) and returns the ones that got a time.
 */
export async function readTimesFor(cars, { headless = true } = {}) {
  if (cars.length === 0) return [];
  return withContext(headless, async (context) => {
    const timed = [];
    for (const c of cars) {
      const listed = await fetchListedText(context, c.url);
      const { text, at } = parseListed(listed);
      c.postedText = text;
      c.postedAt = at;
      if (at) timed.push(c);
      await new Promise((r) => setTimeout(r, 700 + Math.random() * 700));
    }
    return timed;
  });
}
