// Runs the scraper on a timer:  npm start
import 'dotenv/config';
import { runOnce } from './run.js';

const intervalMin = Math.max(1, parseInt(process.env.CHECK_INTERVAL_MINUTES || '1', 10));
const jitterSec = Math.max(0, parseInt(process.env.CHECK_JITTER_SECONDS || '30', 10));

let running = false;

async function cycle() {
  if (running) {
    console.log('  (previous run still going — skipping this tick)');
    return;
  }
  running = true;
  try {
    await runOnce();
  } catch (err) {
    console.error('Run error:', err.message);
  } finally {
    running = false;
  }
}

function scheduleNext() {
  const jitter = Math.floor(Math.random() * (jitterSec + 1)) * 1000;
  const delay = intervalMin * 60 * 1000 + jitter;
  console.log(`Next check in ${(delay / 1000).toFixed(0)}s.`);
  setTimeout(async () => {
    await cycle();
    scheduleNext();
  }, delay);
}

console.log('==================================================');
console.log(' GAD Marketplace scraper started');
console.log(` Interval: every ${intervalMin} min (+ up to ${jitterSec}s jitter)`);
console.log(' Press Ctrl+C to stop.');
console.log('==================================================');

// Run immediately, then schedule.
cycle().then(scheduleNext);
