# Deployment Guide

This document covers deploying the unified frontend and both Lambda backends to AWS.

## Architecture

```
Browser → CloudFront
  ├── /*    → S3 (React static app — unified frontend)
  └── /api* → Lambda@Edge (SigV4 signer) → Lambda Function URL (AuthType: AWS_IAM)
```

Two independent CloudFormation stacks, one per backend:

| Stack | Template | SAM config env | Lambda backend |
|-------|----------|----------------|----------------|
| `claude-cert-demo` | `template.yaml` | `single-agent` | `01-agent-loop/ui/backend/` |
| `claude-cert-multi-agent` | `template-multi.yaml` | `multi-agent` | `02-multi-agent/ui/backend/` |

Each stack gets its own CloudFront distribution, S3 bucket, and Lambda Function URL.

---

## Prerequisites

- AWS CLI configured with a user that has: `cloudformation:*`, `s3:*`, `lambda:*`, `cloudfront:*`, `iam:PassRole`, `iam:GetRole`
- AWS SAM CLI: `pip install aws-sam-cli`
- Node.js 18+

**Important:** Lambda@Edge functions must be deployed to `us-east-1` regardless of where you want your Lambda backend to run. The `region = "us-east-1"` in `samconfig.toml` is intentional.

---

## Deploying

All SAM commands run from the `ui/` directory.

### Single-agent stack

```bash
cd ui/
sam build
sam deploy --config-env single-agent
```

### Multi-agent stack

```bash
cd ui/
sam build -t template-multi.yaml
sam deploy --config-env multi-agent \
  --parameter-overrides \
    "AnthropicApiKey=sk-ant-..." \
    "HumanEscalationEmail=support@example.com"
```

### Uploading the frontend

After SAM deploy, build the React app and sync it to the S3 bucket output by the stack:

```bash
# Get the bucket name from the stack
BUCKET=$(aws cloudformation describe-stacks \
  --stack-name claude-cert-demo \
  --query "Stacks[0].Outputs[?OutputKey=='FrontendBucketName'].OutputValue" \
  --output text)

cd ui/frontend
npm ci && npm run build

aws s3 sync dist/ s3://$BUCKET/ \
  --delete \
  --cache-control "public,max-age=31536000,immutable" \
  --exclude "index.html"

aws s3 cp dist/index.html s3://$BUCKET/index.html \
  --cache-control "no-cache,no-store,must-revalidate"
```

Then invalidate the CloudFront cache:

```bash
DIST_ID=$(aws cloudformation describe-stacks \
  --stack-name claude-cert-demo \
  --query "Stacks[0].Outputs[?OutputKey=='CloudFrontDistributionId'].OutputValue" \
  --output text)

aws cloudfront create-invalidation \
  --distribution-id $DIST_ID \
  --paths "/*"
```

---

## CI/CD (GitHub Actions)

The `deploy.yml` workflow is a manual-trigger pipeline. Go to **Actions → Deploy → Run workflow** and pick the stack (`single-agent` or `multi-agent`).

Required GitHub secrets:

| Secret | Description |
|--------|-------------|
| `AWS_ACCESS_KEY_ID` | IAM user access key |
| `AWS_SECRET_ACCESS_KEY` | IAM user secret |
| `AWS_REGION` | e.g. `us-east-1` |
| `ANTHROPIC_API_KEY` | Used by multi-agent stack only |
| `REFUND_THRESHOLD` | e.g. `500` |
| `HUMAN_ESCALATION_EMAIL` | e.g. `support@example.com` |

---

## Why Lambda@Edge instead of CloudFront OAC?

CloudFront OAC can sign S3 requests, but it **cannot sign POST request bodies**. Lambda Function URLs require the full payload hash (`x-amz-content-sha256`) in the SigV4 signature for POST/PUT requests. OAC only signs headers, not bodies, so it produces `InvalidSignatureException` for any POST.

Lambda@Edge at the `origin-request` event runs in the CloudFront edge network and can read the full request body (`IncludeBody: true`) before signing. Browsers make unsigned requests to CloudFront; the edge signer adds the SigV4 headers transparently.

### Both Lambda permissions are required

The Lambda@Edge role needs **both** of these permissions on the backend function:

```yaml
- lambda:InvokeFunctionUrl   # To call the Function URL endpoint
- lambda:InvokeFunction      # Also required — without it: AccessDeniedException
```

`InvokeFunctionUrl` alone is not sufficient. Both resource-based permissions (`EdgeSignerInvokePermission` and `EdgeSignerInvokePermission2` in the templates) are required.

### Do not use a Condition on the policy

Scoping the policy with `Condition: { StringEquals: { lambda:FunctionUrlAuthType: AWS_IAM } }` looks semantically correct but causes `AccessDeniedException` at runtime. Scope by `Resource` ARN only.

---

## Debugging API errors

The `CustomErrorResponses` block maps 403 and 404 from all origins (including Lambda) to `index.html` for SPA routing. This means a Lambda auth failure (bad SigV4 signature → 403) silently returns `index.html` instead of the real error.

**To see the real error:** temporarily remove the `CustomErrorResponses` block from the template and redeploy. The raw CloudFront error response will appear in the browser.
