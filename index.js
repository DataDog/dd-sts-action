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
const parsedRetries = parseInt(process.env.INPUT_RETRIES, 10);
const retries = Number.isInteger(parsedRetries) && parsedRetries >= 0 ? parsedRetries : 5;

// note that audience has a default value so it's required here
// but it's not required for the user to set it in the workflow
if (!domain || !policy || !audience) {
    console.log(`::error::Missing required inputs 'domain', 'policy', and 'audience'`);
    process.exit(1);
}

async function fetchWithRetry(url, options = {}, retries = 5, initialDelay = 1000) {
    const maxAttempts = retries + 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const start = Date.now();
        try {
            console.log(`::debug::Requesting ${options.method || 'GET'} ${url} (attempt ${attempt})`);
            const response = await fetch(url, options);
            console.log(`Response from ${url}: HTTP ${response.status} (${Date.now() - start}ms)`);
            if (!response.ok) {
                const errorBody = await response.text();
                const error = new Error(`HTTP error! status: ${response.status}, ${errorBody}`);
                error.status = response.status;
                throw error;
            }

            return response;
        } catch (error) {
            const elapsed = Date.now() - start;

            // 4XX responses indicate client errors that won't be fixed by retrying.
            if (error.status >= 400 && error.status < 500) {
                console.warn(`Request to ${url} failed with non-retryable status ${error.status} (${elapsed}ms).`);
                throw error;
            }

            const details = [error.message, error.code && `code=${error.code}`, error.cause && `cause=${error.cause}`]
                .filter(Boolean).join(', ');
            console.warn(`Attempt ${attempt} for ${url} failed after ${elapsed}ms: ${details}`);

            // No retries left; surface the underlying error.
            if (attempt >= maxAttempts) {
                throw error;
            }

            const jitter = Math.floor(Math.random() * 5000);
            const delay = Math.min(2 ** attempt * initialDelay + jitter, 10000); // Limit max delay to 10 seconds

            console.log(`::debug::Retrying ${url} in ${delay}ms`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

async function getOidcToken(actionsUrl, audience, actionsToken, retries) {
    console.log(`Requesting GitHub OIDC token with audience '${audience}'...`);
    const res = await fetchWithRetry(`${actionsUrl}&audience=${audience}`, { headers: { 'Authorization': `Bearer ${actionsToken}` } }, retries);
    const json = await res.json();

    if (!json.value) {
        throw new Error('GitHub OIDC token response did not include a token value.');
    }

    console.log('Successfully retrieved GitHub OIDC token.');
    return json.value;
}

async function exchangeOidcForCredentials(domain, policy, oidcToken, retries) {
    const exchangeUrl = `https://${domain}/sts/datadog/exchange?policy=${encodeURIComponent(policy)}`;
    console.log(`Exchanging OIDC token for Datadog credentials at '${exchangeUrl}'...`);
    const res = await fetchWithRetry(
        exchangeUrl,
        {
            headers: {
                'Authorization': `Bearer ${oidcToken}`,
                'x-datadog-target-release': 'dd-sts.dd-sts'
            }
        },
        retries
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
        console.log(`Starting dd-sts-action with domain='${domain}', policy='${policy}', audience='${audience}', retries='${retries}'.`);

        const oidcToken = await getOidcToken(actionsUrl, audience, actionsToken, retries);

        let credentials;

        try {
            credentials = await exchangeOidcForCredentials(domain, policy, oidcToken, retries);
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

        fs.appendFileSync(process.env.GITHUB_OUTPUT, outputParts.join('\n'));

        console.log('dd-sts-action completed successfully.');
    } catch (err) {
        console.log(`::error::${err.stack}`);
        process.exit(1);
    }
})();
