'use strict';

const fs = require('fs');

const summaryPath = process.env.GITHUB_STEP_SUMMARY;
const actionsToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
const actionsUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;

if (!actionsToken || !actionsUrl) {
    console.log(`::error::Missing required environment variables; have you set 'id-token: write' in your workflow permissions?`);
    process.exit(1);
}

const domain = process.env.INPUT_DOMAIN;
const policy = process.env.INPUT_POLICY;
const audience = "rapid-seceng-sit";

if (!scope || !policy) {
    console.log(`::error::Missing required inputs 'scope' and 'policy'`);
    process.exit(1);
}

async function fetchWithRetry(url, options = {}, retries = 3, initialDelay = 1000) {
    let attempt = 1;

    while (retries > 0) {
        try {
            const response = await fetch(url, options);
            if (!response.ok) {
                errorBody = await response.text();
                throw new Error(`HTTP error! status: ${response.status}, ${errorBody}`);
            }

            return response;
        } catch (error) {
            console.warn(`Attempt ${attempt} failed. Error: ${error.message}`);

            const jitter = Math.floor(Math.random() * 5000);
            const delay = Math.min(2 ** attempt * initialDelay + jitter, 10000); // Limit max delay to 10 seconds

            await new Promise(resolve => setTimeout(resolve, delay));

            attempt++;
            retries--;
        }
    }

    throw new Error(`Fetch failed after ${attempt} attempts.`);
}

(async function main() {
    try {
        const res = await fetchWithRetry(`${actionsUrl}&audience=${audience}`, { headers: { 'Authorization': `Bearer ${actionsToken}` } }, 5);
        const json = await res.json();
        let res2, json2, tok;

        try {
            res2 = await fetchWithRetry(
                `https://${domain}/sts/datadog/exchange?policy=${policy}`,
                {
                    headers: {
                        'Authorization': `Bearer ${json.value}`,
                        'x-datadog-target-release': 'dd-sts.dd-sts'
                    }
                }
            );

            json2 = await res2.json();
            if (!json2.token) { console.log(`::error::${json2.message}`); process.exit(1); }
            tok = json2.token;
        } catch (error) {
            const claims = JSON.parse(Buffer.from(json.value.split('.')[1], 'base64').toString());
            console.log('JWT claims:\n', JSON.stringify(claims, null, 2));

            const markdown = [
                '### ⚠️ DD STS request failed',
                '',
                'OIDC token claims for debugging:',
                '',
                '```json',
                JSON.stringify(claims, null, 2),
                '```',
                '',
            ].join('\n');

            fs.appendFileSync(summaryPath, markdown + '\n');

            throw error;
        }

        const crypto = require('crypto');
        const tokHash = crypto.createHash('sha256').update(tok).digest('hex');
        console.log(`Token hash: ${tokHash}`);
        console.log(`::add-mask::${tok}`);

        fs.appendFile(process.env.GITHUB_OUTPUT, `token=${tok}`, function (err) { if (err) throw err; }); // Write the output.
        fs.appendFile(process.env.GITHUB_STATE, `token=${tok}`, function (err) { if (err) throw err; }); // Write the state, so the post job can delete the token.
    } catch (err) {
        console.log(`::error::${err.stack}`); process.exit(1);
    }
})();
