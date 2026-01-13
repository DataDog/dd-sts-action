'use strict';

const appKey = process.env.STATE_APP_KEY;

if (!appKey) {
    console.log('No application key to revoke, skipping cleanup.');
    process.exit(0);
}

const domain = process.env.INPUT_DOMAIN;
const policy = process.env.INPUT_POLICY;

if (!domain || !policy) {
    console.log(`::error::Missing required inputs 'domain' or 'policy'`);
    process.exit(1);
}

async function revokeAppKey(domain, policy, appKey) {
    const url = `https://${domain}/sts/datadog/revoke?policy=${policy}`;

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
    await revokeAppKey(domain, policy, appKey);
})();
