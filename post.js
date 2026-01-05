'use strict';

const appKey = process.env.STATE_APP_KEY;
const domain = process.env.INPUT_DOMAIN;

if (!appKey || !domain) {
    console.log('No application key to revoke, skipping cleanup.');
    process.exit(0);
}

async function revokeAppKey(domain, appKey) {
    const url = `https://${domain}/sts/datadog/revoke`;

    try {
        const response = await fetch(url, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${appKey}`,
                'x-datadog-target-release': 'dd-sts.dd-sts'
            }
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.warn(`Failed to revoke application key: HTTP ${response.status}, ${errorBody}`);
            // Don't fail the workflow on cleanup errors
            return;
        }

        console.log('Application key successfully revoked.');
    } catch (error) {
        console.warn(`Error revoking application key: ${error.message}`);
        // Don't fail the workflow on cleanup errors
    }
}

(async function main() {
    await revokeAppKey(domain, appKey);
})();
