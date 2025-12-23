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
- env:
    DD_API_KEY: ${{ steps.dd-sts.outputs.api_key }}
    DD_APP_KEY: ${{ steps.dd-sts.outputs.app_key }}
  run: |
    set -euo pipefail
    resp="$(curl -fsS -H "DD-API-KEY: ${DD_API_KEY}" "https://api.${DD_SITE}/api/v1/validate")"
    echo "$resp" | jq -e '.valid == true' > /dev/null
    echo "Datadog API key is valid."
```
