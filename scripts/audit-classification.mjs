#!/usr/bin/env node
/**
 * The classification audit: every History-tab item at a location,
 * with the evidence for its tag. Run against a dev server and PASTE
 * THE OUTPUT into any PR that touches existence classification.
 *
 *   node scripts/audit-classification.mjs [lat] [lng] [port]
 */
const [lat = '51.4816', lng = '-0.0076', port = '8081'] = process.argv.slice(2);

const response = await fetch(`http://localhost:${port}/api/history?lat=${lat}&lng=${lng}`);
if (!response.ok) {
  console.error(`history request failed: ${response.status}`);
  process.exit(1);
}
const { items } = await response.json();

const nearby = items.filter((item) => item.thumbnailUrl && !item.pastTag);
const archive = items.filter((item) => !item.thumbnailUrl || item.pastTag);

console.log(`NEARBY ${nearby.length} · HISTORY ${archive.length}\n`);
console.log('HISTORY tab, with evidence:');
for (const item of archive) {
  const tag = item.source.startsWith('Open Plaques')
    ? 'Plaque (physical artifact)'
    : (item.pastTag ?? '— untagged (no structured fact; honest silence)');
  console.log(`  ${tag.padEnd(42)} ${item.title.slice(0, 55)}`);
}
console.log('\nTagged items in NEARBY (must be empty):');
const leaks = nearby.filter((item) => item.pastTag);
for (const item of leaks) {
  console.log(`  LEAK: ${item.pastTag} — ${item.title}`);
}
if (leaks.length === 0) {
  console.log('  none ✓');
}
