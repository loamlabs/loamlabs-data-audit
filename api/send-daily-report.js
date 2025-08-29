import { Redis } from '@upstash/redis';
import { Resend } from 'resend';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const resend = new Resend(process.env.RESEND_API_KEY);

function formatPrice(valueInCents) {
    const n = Number(valueInCents);
    return isNaN(n) ? "$0.00" : `$${(n / 100).toFixed(2)}`;
}

export default async function handler(req, res) {
    const authHeader = req.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    try {
        const buildsJson = await redis.lrange('abandoned_builds', 0, -1);
        if (buildsJson.length > 0) {
            await redis.del('abandoned_builds');
        }

        if (buildsJson.length === 0) {
            console.log('No abandoned builds to report today.');
            return res.status(200).json({ message: 'No builds to report.' });
        }

        const builds = buildsJson.map(b => JSON.parse(b));

        let buildsHtml = '';
        builds.forEach((build, index) => {
            const getComp = (pos, type) => build.components[`${pos}${type}`]?.title || '<em>Not Selected</em>';
            let visitorHtml = '';
            if (build.visitor) {
                if (build.visitor.isLoggedIn) {
                    const customerUrl = `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/customers/${build.visitor.customerId}`;
                    visitorHtml = `<tr><td>User</td><td><strong><a href="${customerUrl}" target="_blank">${build.visitor.firstName || ''} ${build.visitor.lastName || ''}</a></strong><br><small>${build.visitor.email}</small></td></tr>`;
                } else {
                    visitorHtml = `<tr><td>User</td><td>Anonymous Visitor<br><small>ID: ${build.visitor.anonymousId}</small></td></tr>`;
                }
            }

            buildsHtml += `<div class="build-section"><h3>Build #${index + 1} (ID: ${build.buildId})</h3><p>Captured: ${new Date(build.capturedAt).toLocaleString()}</p><table class="data-table">${visitorHtml}<tr><td>Type</td><td><strong>${build.buildType}</strong></td></tr><tr><td>Style</td><td>${build.ridingStyleDisplay}</td></tr>${(build.buildType === 'Front' || build.buildType === 'Wheel Set') ? `<tr><td colspan="2" class="subheader">Front Wheel</td></tr><tr><td>Front Rim</td><td>${getComp('front', 'Rim')}</td></tr><tr><td>Front Hub</td><td>${getComp('front', 'Hub')}</td></tr>` : ''}${(build.buildType === 'Rear' || build.buildType === 'Wheel Set') ? `<tr><td colspan="2" class="subheader">Rear Wheel</td></tr><tr><td>Rear Rim</td><td>${getComp('rear', 'Rim')}</td></tr><tr><td>Rear Hub</td><td>${getComp('rear', 'Hub')}</td></tr>` : ''}<tr><td>Subtotal</td><td><strong>${formatPrice(build.subtotal)}</strong></td></tr></table></div>`;
        });

        const emailHtml = `<!DOCTYPE html><html><head><style>body{font-family:sans-serif;color:#333}a{color:#007bff;text-decoration:none}.container{max-width:600px;margin:auto;padding:20px;border:1px solid #ddd}.build-section{margin-bottom:20px;padding-bottom:20px;border-bottom:1px solid #eee}.data-table{border-collapse:collapse;width:100%}.data-table td{padding:8px;border:1px solid #ddd}.data-table td:first-child{font-weight:bold;width:120px}.subheader{background-color:#f7f7f7;text-align:center;font-weight:bold}</style></head><body><div class="container"><h2>Daily Abandoned Build Report</h2><p>Found <strong>${builds.length}</strong> significant build(s) that were started but not added to the cart in the last 24 hours.</p>${buildsHtml}</div></body></html>`;

        await resend.emails.send({
            from: 'Builder Reports <reports@loamlabsusa.com>',
            to: [process.env.BUILDER_EMAIL_ADDRESS],
            subject: `Abandoned Build Report: ${builds.length} build(s)`,
            html: emailHtml,
        });

        return res.status(200).json({ message: `Report sent for ${builds.length} builds.` });
    } catch (error) {
        console.error('Error sending daily report:', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
}
