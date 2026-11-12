// lib/abandoned-email.js
// The daily Abandoned Build Report email, as pure functions (no network), so the text can be tested.
// Keeps the Curated / Manual split; adds an Origin line per build, origin counts in the title, and a visible Test line (test builds are never silently dropped).
const KIND_ORDER = ['scratch', 'preset', 'precfg_link', 'share', 'resume', 'saved', 'cart_edit', 'unknown'];
const KIND_COUNT_LABEL = { scratch: 'Scratch', preset: 'Preset', precfg_link: 'Preconfigured', share: 'Share', resume: 'Resume', saved: 'Saved', cart_edit: 'Cart edit', unknown: 'Unknown' };
const REASON_LABEL = { 'pattern:known_fingerprint': 'known test builds', 'pattern:fixed_interval': 'fixed-interval pattern', automation: 'automated browser' };

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function originOf(build) {
    const o = build && build.origin && typeof build.origin === 'object' ? build.origin : null;
    return o && KIND_ORDER.concat(['curated']).includes(String(o.kind)) ? o : null;
}
const isCurated = (b) => b.quickBuildGenerated === true || (originOf(b) && originOf(b).kind === 'curated');
const kindOf = (b) => (isCurated(b) ? 'curated' : (originOf(b) ? originOf(b).kind : 'unknown'));

/** "Preset H2-FUSE29C, changed" / "Scratch" / "Share link, unchanged" / "Unknown (old theme)" */
function originLabel(build) {
    const o = originOf(build);
    if (!o) return isCurated(build) ? 'Curated (old theme)' : 'Unknown (old theme)';
    const ref = o.ref ? ` ${esc(o.ref)}` : '';
    const names = { scratch: 'Scratch', preset: 'Preset' + ref, precfg_link: 'Preconfigured build' + ref, curated: 'Curated Quick Build', share: 'Share link', resume: 'Resumed build', saved: 'Saved build', cart_edit: 'Edit from cart' };
    const base = names[o.kind] || 'Unknown (old theme)';
    const state = o.changed === true ? ', changed' : (o.changed === false ? ', unchanged' : '');
    return o.kind === 'scratch' ? base : base + state;
}

/** "Nov 11, 9:05 AM EST" */
function timeEst(iso) {
    const d = new Date(iso); if (isNaN(d)) return '';
    return d.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' });
}

function renderWheelComponents(list) {
    if (!list || list.length === 0) return '';
    return list.map((c) => `<tr><td class="component-label">${esc(c.type)}</td><td class="component-name">${esc(c.name)}</td></tr>`).join('');
}

/** @param builds  Redis packets still to report (cart-bound ones are skipped here as well)
 *  @param tests   [{ build, reason }] flagged as tests: counted, not listed
 *  @param repeats Map(buildId -> visitor count) the soft "same parts from N visitors" notes
 *  @returns { subject, html, shown, testCount } or null when there is nothing at all */
function renderReport({ builds = [], tests = [], repeats = new Map(), shopDomain = '' } = {}) {
    const shown = builds.filter((b) => !(originOf(b) && originOf(b).addedToCart));
    if (shown.length === 0 && tests.length === 0) return null;

    const curated = shown.filter(isCurated); const manual = shown.filter((b) => !isCurated(b));
    const counts = {}; for (const b of shown) { const k = kindOf(b); counts[k] = (counts[k] || 0) + 1; }
    const parts = KIND_ORDER.filter((k) => counts[k]).map((k) => `${counts[k]} ${KIND_COUNT_LABEL[k]}`); parts.push(`${curated.length} Curated`);
    const subject = `Abandoned Build Report: ${shown.length} build(s) (${parts.join(' / ')})` + (tests.length ? ` + ${tests.length} Test not shown` : '');

    const card = (build, index, prefix) => {
        let visitorHtml = '';
        if (build.visitor) {
            if (build.visitor.isLoggedIn) {
                const url = `https://${shopDomain}/admin/customers/${build.visitor.customerId}`;
                const name = `${build.visitor.firstName || ''} ${build.visitor.lastName || ''}`.trim();
                visitorHtml = `<tr><td>User</td><td><strong><a href="${esc(url)}" target="_blank">${esc(name || 'Customer')}</a></strong><br><small>${esc(build.visitor.email)}</small></td></tr>`;
            } else visitorHtml = `<tr><td>User</td><td>Anonymous Visitor<br><small>ID: ${esc(build.visitor.anonymousId)}</small></td></tr>`;
        }
        const front = build.components && build.components.front && build.components.front.length > 0;
        const rear = build.components && build.components.rear && build.components.rear.length > 0;
        const profile = build.quickBuildGenerated ? `<span style="font-weight: normal; font-size: 0.8em; color: #555;"> (Profile: ${esc(build.quickBuildMaterial)} ${esc(build.quickBuildGoal)})</span>` : '';
        const rep = repeats.get(build.buildId); const repeatNote = rep ? `<tr><td>Note</td><td>Same parts from ${rep} visitors in 24 hours</td></tr>` : '';
        return `
            <div class="build-section">
                <h3>${prefix} #${index + 1} (ID: ${esc(build.buildId)})${profile}</h3>
                <p>Captured: ${esc(timeEst(build.capturedAt))}</p>
                <table class="data-table">
                    <tr><td>Origin</td><td><strong>${originLabel(build)}</strong></td></tr>
                    ${visitorHtml}
                    <tr><td>Type</td><td><strong>${esc(build.buildType)}</strong></td></tr>
                    <tr><td>Style</td><td>${esc(build.ridingStyleDisplay)}</td></tr>
                    ${front ? `<tr><td colspan="2" class="subheader">Front Wheel</td></tr>${renderWheelComponents(build.components.front)}` : ''}
                    ${rear ? `<tr><td colspan="2" class="subheader">Rear Wheel</td></tr>${renderWheelComponents(build.components.rear)}` : ''}
                    ${repeatNote}
                    <tr><td>Subtotal</td><td><strong>${'$' + ((build.subtotal || 0) / 100).toFixed(2)}</strong></td></tr>
                </table>
            </div>`;
    };

    let testLine = '';
    if (tests.length) {
        const byReason = {}; for (const t of tests) { const l = REASON_LABEL[t.reason] || t.reason || 'test'; byReason[l] = (byReason[l] || 0) + 1; }
        testLine = `<p style="background:#f7f7f7;padding:8px;border:1px solid #ddd"><strong>Test:</strong> ${tests.length} test build(s) not shown (${Object.entries(byReason).map(([l, n]) => `${n} ${esc(l)}`).join(', ')}). They are kept in the history.</p>`;
    }

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body{font-family:sans-serif;color:#333}
            a{color:#007bff;text-decoration:none}
            .container{max-width:600px;margin:auto;padding:20px;border:1px solid #ddd}
            .build-section{margin-bottom:20px;padding-bottom:20px;border-bottom:1px solid #eee}
            .data-table{border-collapse:collapse;width:100%}
            .data-table td{padding:8px;border:1px solid #ddd}
            .data-table td:first-child{font-weight:bold;width:120px;}
            .component-label{font-weight:normal !important;padding-left:25px !important;}
            .component-name{font-weight:bold;}
            .subheader{background-color:#f7f7f7;text-align:center;font-weight:bold}
        </style>
    </head>
    <body>
        <div class="container">
            <h2>Daily Abandoned Build Report</h2>
            <p>Found <strong>${shown.length}</strong> significant build(s) in the last 24 hours (${parts.join(' / ')}).</p>
            ${testLine}
            ${curated.length > 0 ? `
                <h2 style="color: #28a745; border-bottom: 2px solid #28a745; padding-bottom: 5px; margin-top: 30px;">&#9889; Curated Quick Builds (${curated.length})</h2>
                ${curated.map((b, i) => card(b, i, 'Curated Build')).join('')}` : ''}
            ${manual.length > 0 ? `
                <h2 style="color: #007bff; border-bottom: 2px solid #007bff; padding-bottom: 5px; margin-top: 30px;">&#128736; Manual Custom Builds (${manual.length})</h2>
                ${manual.map((b, i) => card(b, i, 'Manual Build')).join('')}` : ''}
        </div>
    </body>
    </html>`;
    return { subject, html, shown: shown.length, testCount: tests.length };
}

module.exports = { originLabel, timeEst, renderReport, isCurated, kindOf };
