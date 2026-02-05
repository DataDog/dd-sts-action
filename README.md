# dd-sts-action

This action exchanges the workflow's identity token for Datadog credentials according to a target trust policy.

## Usage

Consider the following workflow in `DataDog/my-repo`:

```yaml
permissions:
  id-token: write # Needed to federate tokens.

steps:
- id: dd-sts
  uses: DataDog/dd-sts-action@main
  with:
    policy: foo # policy filename excluding `.yaml`
    audience: rapid-seceng-sit # must match the audience configured in your dd-sts policy
- env:
    DD_API_KEY: ${{ steps.dd-sts.outputs.api_key }}
    DD_APP_KEY: ${{ steps.dd-sts.outputs.app_key }}
  run: |
    set -euo pipefail
    resp="$(curl -fsS -H "DD-API-KEY: ${DD_API_KEY}" "https://api.${DD_SITE}/api/v1/validate")"
    echo "$resp" | jq -e '.valid == true' > /dev/null
    echo "Datadog API key is valid."
```

## Inputs

- `policy` (required): The name of the trust policy to use (excluding `.yaml` extension)
- `audience` (optional): The audience value for the OIDC token. Must match the audience configured in your dd-sts policy. Defaults to `rapid-seceng-sit`.
- `domain` (optional): The domain of the Datadog STS instance to use. Defaults to `webhooks.build.datadoghq.com`.

## Outputs

- `api_key`: A Datadog API key
- `app_key`: A Datadog application key (if provided by the policy)
- `app_key_expiration_timestamp`: The expiration timestamp of the application key (if applicable)
