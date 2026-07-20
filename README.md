# 🚗 GAD Marketplace Dashboard

Monitors **Facebook Marketplace** for new **car** listings in **Bellflower, Montclair & Fontana**, stores them in **Supabase**, shows them live in a **Next.js** dashboard, and **emails** you when a matching car appears.

```
scraper (your PC, Playwright)  ──▶  Supabase (Postgres)  ──▶  Next.js dashboard
        │
        └──▶ emails you on new matches
```

> ⚠️ **Important reality check.** Facebook has **no API** for browsing other people's Marketplace listings, so the scraper drives a real logged-in browser. This is against Facebook's Terms of Service and can get an account rate-limited or restricted — **use a secondary/throwaway account**, never your main or business one. Checking every 1 minute is aggressive; if the account gets warnings, raise `CHECK_INTERVAL_MINUTES`.

---

## Folder layout

| Folder | What it is |
|---|---|
| `supabase/` | `schema.sql` — the database table + security rules |
| `scraper/` | Node + Playwright worker that reads Marketplace and writes to Supabase |
| `web/` | Next.js dashboard that reads from Supabase (live) |

---

## Setup — do these once

### 1. Supabase
1. Create a free project at [supabase.com](https://supabase.com).
2. Open **SQL Editor**, paste all of `supabase/schema.sql`, and run it.
3. Go to **Project Settings → API** and copy three things:
   - **Project URL**
   - **anon public** key (for the website)
   - **service_role** key (secret, for the scraper)

### 2. Scraper (`scraper/`)
```bash
cd scraper
npm install                 # also downloads a Chromium browser
copy .env.example .env      # (PowerShell: cp .env.example .env)
```
Edit `.env` and fill in:
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- Gmail alert settings (see **Email** below)

Then log into Facebook once (opens a real browser window):
```bash
npm run login
```
Log into your **secondary** FB account, reach the normal home feed, then press **ENTER** in the terminal. Your session is saved to `scraper/data/fb-session.json` (git-ignored).

Do a single test run and watch the output:
```bash
npm run scrape
```
When it works, run it on the timer:
```bash
npm start                   # checks every minute (+ jitter), forever
```

### 3. Website (`web/`)
```bash
cd web
npm install
copy .env.local.example .env.local
```
Edit `.env.local` with your `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`, then:
```bash
npm run dev                 # open http://localhost:3000
```
New cars appear **live** (no refresh) thanks to Supabase realtime.

---

## Email alerts (Gmail)
1. On the Gmail account, turn on **2-Step Verification**.
2. Create an **App Password**: <https://myaccount.google.com/apppasswords>
3. Put the 16-character password in `scraper/.env` as `GMAIL_APP_PASSWORD`.
   (You never share it with anyone — it stays in your local `.env`.)

Set `EMAIL_ENABLED=false` to turn emails off.

---

## Telling it which cars you want

Edit `scraper/config.json` → `filters.wanted`. It's a **list**; a car is kept if it
matches **any** entry (and each entry's fields must **all** match). Omit fields you
don't care about. Leave `wanted: []` to keep every car.

```json
"wanted": [
  { "make": "Toyota", "models": ["Camry", "Corolla"], "yearMin": 2012, "priceMax": 15000, "maxMileage": 150000 },
  { "make": "Honda",  "models": ["Civic", "Accord"],  "yearMin": 2014, "priceMax": 14000 }
]
```

Supported fields per entry: `make`, `models` (list), `keywords` (list), `yearMin`,
`yearMax`, `priceMin`, `priceMax`, `maxMileage`. `excludeKeywords` (top level) drops
any listing whose title contains those words.

### The city search URLs
The URLs in `config.json` are best-guess. To be exact: open Facebook Marketplace,
pick the city, choose **Vehicles**, sort by **Date listed: Newest first**, then copy
the browser URL into `config.json`. Keep `&sortBy=creation_time_descend` for newest-first.

---

## Tuning / safety
- `CHECK_INTERVAL_MINUTES` — minutes between checks (raise this if FB complains).
- `CHECK_JITTER_SECONDS` — random extra delay so runs aren't a robotic exact beat.
- `HEADLESS=false` — watch the browser work (good for the first run / debugging).
- If a run says *"Not logged in"*, re-run `npm run login`.
- Facebook changes its page markup often; if listings stop parsing, the selectors in
  `scraper/src/scraper.js` (the part that reads price/title/mileage) may need a tweak.

---

## Deploying the dashboard (optional)
Push `web/` to GitHub and import it on [Vercel](https://vercel.com). Add the two
`NEXT_PUBLIC_*` env vars in the Vercel project settings. The **scraper keeps running
on your PC** (or any always-on machine) — only the website goes to Vercel.
