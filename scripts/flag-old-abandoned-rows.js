// One-off: flag rows already in abandoned_builds_log that look like tests (the same checks the daily job now runs).
//
//   node scripts/flag-old-abandoned-rows.js              DRY RUN: reads, prints counts and the first rows, writes NOTHING
//   node scripts/flag-old-abandoned-rows.js --apply      writes is_test = true + test_reason on the flagged rows (never deletes)
//   node scripts/flag-old-abandoned-rows.js --hours 720  how far back to look (default 336 = 14 days)
//
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment (the same two the collector uses). Prints no keys.
// Run the SQL first (sql/abandoned_builds_origin.sql is NOT needed for this script: it only touches is_test and test_reason, which already exist).
const { fetchRecentRows, detectTests, loadKnownFingerprints, writeFlags, rowKey } = require('../lib/abandoned-flags');

(async () => {
    const args = process.argv.slice(2);
    const apply = args.includes('--apply');
    const hi = args.indexOf('--hours');
    const hours = hi >= 0 && Number(args[hi + 1]) > 0 ? Number(args[hi + 1]) : 336;
    const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) { console.log('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.'); process.exit(1); }

    const got = await fetchRecentRows({ url, key, sinceIso: new Date(Date.now() - hours * 3600 * 1000).toISOString() });
    if (!got.ok) { console.log('Could not read the history:', got.reason); process.exit(2); }
    const rows = got.rows;
    const { hard, soft } = detectTests(rows, { knownFingerprints: loadKnownFingerprints(process.env) });

    const byReason = {}; for (const r of hard.values()) byReason[r] = (byReason[r] || 0) + 1;
    console.log(`Rows read (last ${hours} hours): ${rows.length} | already is_test: ${rows.filter((r) => r.is_test).length}`);
    console.log(`Would flag as test (is_test = true): ${hard.size}`, byReason);
    console.log(`Soft notes only (same parts from 3+ visitors, stay visible): ${soft.size}`);
    console.log(`Rows left as real: ${rows.filter((r) => !r.is_test && !hard.has(rowKey(r))).length}`);
    const byKey = new Map(rows.map((r) => [rowKey(r), r]));
    [...hard].slice(0, 8).forEach(([k, why]) => { const r = byKey.get(k); console.log(`  ${r.first_seen} build ${r.build_id} ${why}`); });
    if (hard.size > 8) console.log(`  ... and ${hard.size - 8} more`);

    if (!apply) { console.log('\nDRY RUN: nothing written. Run again with --apply to write the flags.'); return; }
    const w = await writeFlags({ url, key, rows, hard, soft });
    console.log(`\nWritten: ${w.written}, failed: ${w.failed}.`);
})().catch((e) => { console.log('ERR', e.message); process.exit(1); });
