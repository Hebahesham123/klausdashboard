// Single test run:  npm run scrape
import 'dotenv/config';
import { runOnce } from './run.js';

runOnce()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Scrape failed:', err.message);
    process.exit(1);
  });
