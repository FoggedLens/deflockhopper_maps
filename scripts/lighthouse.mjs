#!/usr/bin/env node
/**
 * Automated Lighthouse audit against the production preview build.
 *
 * Usage:
 *   node scripts/lighthouse.mjs              # run against http://localhost:4173
 *   node scripts/lighthouse.mjs --port 3000  # custom port
 *   node scripts/lighthouse.mjs --url http://maps.deflock.org  # external URL
 *
 * Requires:
 *   - `npm run build` completed
 *   - `npm run preview` running (or pass --url for a live site)
 *   - Playwright installed globally (`playwright install chromium` once)
 */

import { chromium } from 'playwright';
import lighthouse from 'lighthouse';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Parse args
const args = process.argv.slice(2);
const portIdx = args.indexOf('--port');
const urlIdx = args.indexOf('--url');
const port = portIdx !== -1 ? parseInt(args[portIdx + 1]) : 4173;
const url = urlIdx !== -1 ? args[urlIdx + 1] : `http://localhost:${port}`;
const outputJson = args.includes('--json');

console.log(`\n🔦 Running Lighthouse against ${url}\n`);

// Launch Playwright Chromium with remote debugging enabled
const browser = await chromium.launch({
  args: ['--remote-debugging-port=9222'],
  headless: true,
});

const page = await browser.newPage();
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });

// Run Lighthouse using the existing Chrome instance
const result = await lighthouse(url, {
  port: 9222,
  output: outputJson ? 'json' : 'json',
  logLevel: 'silent',
  onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
  throttlingMethod: 'simulate',
  formFactor: 'desktop',
  screenEmulation: {
    mobile: false,
    width: 1350,
    height: 940,
    deviceScaleFactor: 1,
    disabled: false,
  },
  // Use simulated throttling so results are consistent across machines
  throttling: {
    rttMs: 40,
    throughputKbps: 10240,
    cpuSlowdownMultiplier: 1,
    requestLatencyMs: 0,
    downloadThroughputKbps: 0,
    uploadThroughputKbps: 0,
  },
});

await browser.close();

const { categories, audits } = result.lhr;

// Print category scores
console.log('── Category Scores ──────────────────────────');
const catOrder = ['performance', 'accessibility', 'best-practices', 'seo'];
for (const key of catOrder) {
  const cat = categories[key];
  if (!cat) continue;
  const score = Math.round(cat.score * 100);
  const bar = '█'.repeat(Math.round(score / 5)) + '░'.repeat(20 - Math.round(score / 5));
  const color = score >= 90 ? '🟢' : score >= 50 ? '🟡' : '🔴';
  console.log(`  ${color} ${cat.title.padEnd(18)} ${bar} ${score}`);
}

// Print key perf metrics
console.log('\n── Core Web Vitals & Key Metrics ────────────');
const metrics = [
  'first-contentful-paint',
  'largest-contentful-paint',
  'total-blocking-time',
  'speed-index',
  'interactive',
  'cumulative-layout-shift',
];
for (const key of metrics) {
  const a = audits[key];
  if (!a) continue;
  const score = a.score;
  const dot = score === null ? '⚪' : score >= 0.9 ? '🟢' : score >= 0.5 ? '🟡' : '🔴';
  console.log(`  ${dot} ${a.title.padEnd(35)} ${a.displayValue ?? ''}`);
}

// Print failing audits
const failing = Object.values(audits)
  .filter(a => a.score !== null && a.score < 1 && a.score < 0.9)
  .sort((a, b) => a.score - b.score);

if (failing.length) {
  console.log('\n── Failing Audits ───────────────────────────');
  for (const a of failing.slice(0, 15)) {
    const dot = a.score === 0 ? '🔴' : '🟡';
    console.log(`  ${dot} [${(a.score * 100).toFixed(0).padStart(3)}] ${a.title}${a.displayValue ? ' | ' + a.displayValue : ''}`);
  }
}

// Top unused JS
const unusedJs = audits['unused-javascript'];
if (unusedJs?.details?.items?.length) {
  console.log('\n── Top Unused JavaScript ────────────────────');
  for (const item of unusedJs.details.items.slice(0, 6)) {
    const kb = Math.round(item.wastedBytes / 1024);
    const url = item.url.replace(/^https?:\/\/[^/]+/, '').slice(0, 60);
    console.log(`  ${kb.toString().padStart(5)} KB wasted  ${url}`);
  }
}

// Total payload
const payload = audits['total-byte-weight'];
if (payload?.details?.items?.length) {
  const totalKb = Math.round(payload.details.items.reduce((s, i) => s + i.totalBytes, 0) / 1024);
  console.log(`\n── Total Transfer Size: ${totalKb} KB ─────────────`);
}

console.log('\n' + '─'.repeat(48) + '\n');

if (outputJson) {
  console.log(JSON.stringify(result.lhr, null, 2));
}
