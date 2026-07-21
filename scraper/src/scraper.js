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

// Infinite scroll: keep scrolling until no new listings load for several
// rounds in a row (bottom reached), capped by maxRounds as a safety limit.
async function autoScroll(page, maxRounds = 60) {
  let last = 0;
  let stagnant = 0;
  for (let i = 0; i < maxRounds; i++) {
    await page.mouse.wheel(0, 3200);
    await page.waitForTimeout(750 + Math.floor(Math.random() * 450));
    const count = await page.evaluate(
      () => document.querySelectorAll('a[href*="/marketplace/item/"]').length
    );
    if (count <= last) {
      stagnant += 1;
      if (stagnant >= 3) break; // no new cars for 3 rounds => reached the end
    } else {
      stagnant = 0;
    }
    last = count;
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

// Cache seller-id -> active-listing count for this run (a dealer sells many
// cars, so we'd otherwise re-open the same profile again and again).
const sellerCountCache = new Map();

/** Open a seller's Marketplace profile and read the "N active listings" number. */
async function fetchSellerCount(context, href) {
  const url = href.startsWith('http') ? href : 'https://www.facebook.com' + href;
  const p = await context.newPage();
  try {
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await p.waitForTimeout(1800 + Math.random() * 600);
    await p.mouse.wheel(0, 1500);
    await p.waitForTimeout(800);
    return await p.evaluate(() => {
      const m = (document.body.innerText || '').match(/(\d+)\s+active listing/i);
      return m ? parseInt(m[1], 10) : null;
    });
  } catch {
    return null;
  } finally {
    await p.close();
  }
}

/**
 * Read a listing's detail page: "Listed X ago", mileage, phone-in-description,
 * and whether the SELLER is a dealer (has a dealer badge / financing, OR has
 * >= dealerMinListings active listings on their profile).
 */
async function fetchDetail(context, url, dealerMinListings = 3) {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(800 + Math.random() * 500);
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(600);
    const d = await page.evaluate(() => {
      let listed = null;
      let mileage = null;
      const miRe = /(driven\s+)?\d[\d.,]*\s*(k\s*)?(miles?|millas?)\b/i;
      const nodes = Array.from(document.querySelectorAll('span, div, abbr, li'));
      for (const el of nodes) {
        if (el.children.length > 1) continue;
        const s = (el.textContent || '').trim();
        if (!listed && /^listed\s+/i.test(s) && s.length < 80) listed = s;
        if (!mileage && s.length < 45 && miRe.test(s)) mileage = s.match(miRe)[0];
        if (listed && mileage) break;
      }
      const bodyText = document.body.innerText || '';
      if (!mileage) {
        const m = bodyText.match(/\d[\d.,]{2,}\s*(k\s*)?(miles?|millas?)\b/i)
               || bodyText.match(/\d+\s*k\s*(miles?|millas?)\b/i);
        if (m) mileage = m[0];
      }
      const low = bodyText.toLowerCase();
      const badge = low.includes('dealership') || /financ(e|ing)/.test(low);
      // Phone number written in the description (FB never exposes it otherwise).
      const pm = bodyText.match(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/);
      const phone = pm ? pm[0].trim() : null;
      const sa = document.querySelector('a[href*="/marketplace/profile/"]');
      const sellerHref = sa ? sa.getAttribute('href') : null;
      return { listed, mileage, badge, phone, sellerHref };
    });

    // Seller listing count → dealer if they have many cars.
    let count = null;
    if (d.sellerHref) {
      const sid = (d.sellerHref.match(/profile\/(\d+)/) || [])[1];
      if (sid && sellerCountCache.has(sid)) count = sellerCountCache.get(sid);
      else if (sid) {
        count = await fetchSellerCount(context, d.sellerHref);
        if (count != null) sellerCountCache.set(sid, count);
      }
    }
    const dealer = d.badge || (count != null && count >= dealerMinListings);
    return { listed: d.listed, mileage: d.mileage, dealer, phone: d.phone, sellerCount: count };
  } catch {
    return { listed: null, mileage: null, dealer: null, phone: null, sellerCount: null };
  } finally {
    await page.close();
  }
}

async function scrapeCity(context, search) {
  const page = await context.newPage();
  const cars = [];
  try {
    await page.goto(search.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2500);

    if (page.url().includes('/login') || (await page.locator('input[name="email"]').count()) > 0) {
      throw new Error('Not logged in — run `npm run login` again to refresh the Facebook session.');
    }

    await autoScroll(page, search.scrolls || 12);

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

      // Mileage: prefer a dedicated line, else pull it from the title
      // (many sellers write "158.000 Millas" / "84k miles" in the title).
      const miVal = parseMileage(mileageLine) ?? parseMileage(titleLine);
      const miText = mileageLine || (miVal != null ? `${miVal.toLocaleString()} miles` : null);

      cars.push({
        id: r.id,
        title: titleLine,
        priceText: priceLine,
        priceValue: parsePrice(priceLine),
        mileage: miText,
        mileageValue: miVal,
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
      await new Promise((r) => setTimeout(r, 1000 + Math.random() * 1200));
    }
    const byId = new Map();
    for (const c of all) if (!byId.has(c.id)) byId.set(c.id, c);
    return Array.from(byId.values());
  });
}

/**
 * SLOW pass: open each given car's page to read the real "Listed X ago" AND
 * the mileage. Mutates each car and returns the ones that got new detail.
 */
export async function readTimesFor(cars, { headless = true, dealerMinListings = 3 } = {}) {
  if (cars.length === 0) return [];
  return withContext(headless, async (context) => {
    const updated = [];
    for (const c of cars) {
      const { listed, mileage, dealer, phone } = await fetchDetail(context, c.url, dealerMinListings);
      const { text, at } = parseListed(listed);
      c.postedText = text;
      c.postedAt = at;
      if (mileage) {
        c.mileage = mileage;
        c.mileageValue = parseMileage(mileage);
      } else if (!c.mileage) {
        c.mileage = 'Not listed'; // detail checked, seller gave no mileage
      }
      if (dealer != null) c.isDealer = dealer;
      if (phone) c.phone = phone;
      updated.push(c); // always — records that we checked this car's page
      await new Promise((r) => setTimeout(r, 400 + Math.random() * 400));
    }
    return updated;
  });
}
