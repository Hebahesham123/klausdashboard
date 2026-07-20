// One-time login: opens a real Chromium window, you log into the SECONDARY
// Facebook account by hand, then we save the session so the scraper stays
// logged in. Run with:  npm run login
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import readline from 'readline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
const sessionFile = path.join(dataDir, 'fb-session.json');

function waitForEnter(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, () => { rl.close(); resolve(); }));
}

(async () => {
  fs.mkdirSync(dataDir, { recursive: true });
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();
  await page.goto('https://www.facebook.com/login');

  console.log('\n==================================================================');
  console.log(' A browser window opened.');
  console.log(' 1. Log into your SECONDARY Facebook account in that window.');
  console.log(' 2. Make sure you reach your normal Facebook home feed.');
  console.log(' 3. Come back here and press ENTER to save the session.');
  console.log('==================================================================\n');

  await waitForEnter('Press ENTER once you are logged in... ');

  await context.storageState({ path: sessionFile });
  console.log(`\nSaved session to ${sessionFile}`);
  console.log('You can now run:  npm run scrape   (a single test run)');
  console.log('or:               npm start        (runs on a timer)\n');

  await browser.close();
  process.exit(0);
})();
