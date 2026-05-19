/*
* SPDX-License-Identifier: Apache-2.0
* Unless explicitly stated otherwise all files in this repository are licensed under the Apache License Version 2.0.
* Copyright 2026-present Datadog, Inc.
*/

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
const audience = process.env.INPUT_AUDIENCE;

// note that audience has a default value so it's required here
// but it's not required for the user to set it in the workflow
if (!domain || !policy || !audience) {
    console.log(`::error::Missing required inputs 'domain', 'policy', and 'audience'`);
    process.exit(1);
}

async function fetchWithRetry(url, options = {}, retries = 3, initialDelay = 1000) {
    let attempt = 1;

    while (retries > 0) {
        try {
            console.log(`::debug::Requesting ${options.method || 'GET'} ${url} (attempt ${attempt})`);
            const response = await fetch(url, options);
            console.log(`::debug::Response from ${url}: HTTP ${response.status}`);
            if (!response.ok) {
                const errorBody = await response.text();
                const error = new Error(`HTTP error! status: ${response.status}, ${errorBody}`);
                error.status = response.status;
                throw error;
            }

            return response;
        } catch (error) {
            // 4XX responses indicate client errors that won't be fixed by retrying.
            if (error.status >= 400 && error.status < 500) {
                console.warn(`Request to ${url} failed with non-retryable status ${error.status}.`);
                throw error;
            }

            console.warn(`Attempt ${attempt} for ${url} failed. Error: ${error.message}`);

            const jitter = Math.floor(Math.random() * 5000);
            const delay = Math.min(2 ** attempt * initialDelay + jitter, 10000); // Limit max delay to 10 seconds

            console.log(`::debug::Retrying ${url} in ${delay}ms`);
            await new Promise(resolve => setTimeout(resolve, delay));

            attempt++;
            retries--;
        }
    }

    throw new Error(`Fetch failed after ${attempt} attempts.`);
}

async function getOidcToken(actionsUrl, audience, actionsToken) {
    console.log(`Requesting GitHub OIDC token with audience '${audience}'...`);
    const res = await fetchWithRetry(`${actionsUrl}&audience=${audience}`, { headers: { 'Authorization': `Bearer ${actionsToken}` } }, 5);
    const json = await res.json();

    if (!json.value) {
        throw new Error('GitHub OIDC token response did not include a token value.');
    }

    console.log('Successfully retrieved GitHub OIDC token.');
    return json.value;
}

async function exchangeOidcForCredentials(domain, policy, oidcToken) {
    console.log(`Exchanging OIDC token for Datadog credentials at '${domain}' using policy '${policy}'...`);
    const res = await fetchWithRetry(
        `https://${domain}/sts/datadog/exchange?policy=${encodeURIComponent(policy)}`,
        {
            headers: {
                'Authorization': `Bearer ${oidcToken}`,
                'x-datadog-target-release': 'dd-sts.dd-sts'
            }
        }
    );

    const json = await res.json();

    if (!json.api_key) {
        throw new Error(json.message || 'Missing api_key in response');
    }

    console.log('Received credentials');
    return json;
}


(async function main() {
    try {
        console.log(`Starting dd-sts-action with domain='${domain}', policy='${policy}', audience='${audience}'.`);

        const oidcToken = await getOidcToken(actionsUrl, audience, actionsToken);

        let credentials;

        try {
            credentials = await exchangeOidcForCredentials(domain, policy, oidcToken);
        } catch (error) {
            console.log(`::error::Failed to exchange OIDC token for Datadog credentials: ${error.message}`);

            const claims = JSON.parse(Buffer.from(oidcToken.split('.')[1], 'base64').toString());
            const serializedClaims = JSON.stringify(claims, null, 2);

            console.log('JWT claims:\n', serializedClaims);

            const markdown = [
                '### ⚠️ DD STS request failed',
                '',
                'OIDC token claims for debugging:',
                '',
                '```json',
                serializedClaims,
                '```',
                '',
            ].join('\n');

            fs.appendFileSync(summaryPath, markdown + '\n');

            throw error;
        }

        // Mask sensitive credentials in logs
        console.log(`::add-mask::${credentials.api_key}`);
        if (credentials.application_key) {
            console.log(`::add-mask::${credentials.application_key}`);
        }

        // Build output string with only present fields
        const outputParts = [`api_key=${credentials.api_key}`];

        if (credentials.application_key) {
            outputParts.push(`app_key=${credentials.application_key}`);
        }

        if (credentials.expires_at) {
            outputParts.push(`app_key_expiration_timestamp=${credentials.expires_at}`);
        }

        fs.appendFile(process.env.GITHUB_OUTPUT, outputParts.join('\n'), function (err) { if (err) throw err; });

        console.log('dd-sts-action completed successfully.');
    } catch (err) {
        console.log(`::error::${err.stack}`);
        process.exit(1);
    }
})();
