#!/usr/bin/env bash
# One-time GitHub settings for bubltec/greed, mirroring btfp (docs/ci-cd.md there):
#   - squash-only merges, linear history, delete merged branches
#   - `main-merge` ruleset: PR required (1 approval), `CI / check` required,
#     no force-push or deletion; repo admins may bypass *via PR only*, so a solo
#     maintainer can merge their own PR but nobody can push straight to main
#   - `development` and `production` environments; production needs your approval
#   - Actions variables and secrets the deploy workflow reads
#
# Needs: gh (authenticated as a bubltec admin), AWS outputs from `pnpm infra:dns`
# and `npx cdk deploy GreedCi`. Safe to re-run: every call is a PUT/upsert.
set -euo pipefail
REPO=bubltec/greed

echo "== repository merge settings"
gh api -X PATCH "repos/$REPO" \
  -F allow_squash_merge=true -F allow_merge_commit=false -F allow_rebase_merge=false \
  -F delete_branch_on_merge=true -f squash_merge_commit_title=PR_TITLE >/dev/null

echo "== environments"
ME_ID=$(gh api user --jq .id)
gh api -X PUT "repos/$REPO/environments/development" >/dev/null
gh api -X PUT "repos/$REPO/environments/production" --input - >/dev/null <<JSON
{
  "reviewers": [{ "type": "User", "id": $ME_ID }],
  "deployment_branch_policy": { "protected_branches": true, "custom_branch_policies": false }
}
JSON

echo "== main-merge ruleset"
RULESET_ID=$(gh api "repos/$REPO/rulesets" --jq '.[] | select(.name=="main-merge") | .id' || true)
METHOD=POST; URL="repos/$REPO/rulesets"
if [ -n "$RULESET_ID" ]; then METHOD=PUT; URL="repos/$REPO/rulesets/$RULESET_ID"; fi
gh api -X "$METHOD" "$URL" --input - >/dev/null <<'JSON'
{
  "name": "main-merge",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "bypass_actors": [{ "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "pull_request" }],
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "required_linear_history" },
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false
    } },
    { "type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [{ "context": "check" }]
    } }
  ]
}
JSON

echo "== Actions variables (not secret)"
: "${GREED_HOSTED_ZONE_ID:?set GREED_HOSTED_ZONE_ID to the GreedDns HostedZoneId output}"
gh variable set GREED_HOSTED_ZONE_ID --repo "$REPO" --body "$GREED_HOSTED_ZONE_ID"
gh variable set GREED_EDITORS --repo "$REPO" --body "${GREED_EDITORS:-john.josef@gmail.com,github:$ME_ID}"
[ -n "${GREED_GITHUB_CLIENT_ID:-}" ] && gh variable set GREED_GITHUB_CLIENT_ID --repo "$REPO" --body "$GREED_GITHUB_CLIENT_ID"

echo "== Actions secrets (prompted, never echoed)"
: "${AWS_DEPLOY_ROLE_ARN:?set AWS_DEPLOY_ROLE_ARN to the GreedCi DeployRoleArn output}"
gh secret set AWS_DEPLOY_ROLE_ARN --repo "$REPO" --body "$AWS_DEPLOY_ROLE_ARN"
gh secret set GREED_DEV_BASIC_AUTH_USER --repo "$REPO" --body "${GREED_DEV_BASIC_AUTH_USER:-dev}"
if ! gh secret list --repo "$REPO" | grep -q GREED_DEV_BASIC_AUTH_PASSWORD; then
  echo "Enter a password for the dev site's basic auth:"
  gh secret set GREED_DEV_BASIC_AUTH_PASSWORD --repo "$REPO"
fi

echo "Done. Check Settings → Rules, Environments, and Secrets and variables → Actions."
