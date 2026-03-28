# Deployment Guide — TechCo Multi-Agent Support Demo UI

## Architecture

```
Browser → CloudFront (https://xxxxx.cloudfront.net)
  ├── /*     → S3 origin (OAC-signed) — React static app
  └── /api*  → Lambda@Edge (SigV4 signer) → Lambda Function URL (AuthType: AWS_IAM)
```

The frontend is a static React app served from S3+CloudFront. When the user runs a scenario,
the browser POSTs to `/api` (same CloudFront domain — no CORS needed). A Lambda@Edge function
intercepts the origin request, signs it with SigV4 using its IAM role credentials, and forwards
it to the Lambda Function URL. The Function URL uses `AuthType: AWS_IAM` so it is never
directly accessible from the internet.

The coordinator Lambda has a 120-second timeout (vs 30s in 01-agent-loop/ui) because
multi-agent runs with 3 parallel subagents take significantly longer.

### Why Lambda@Edge instead of CloudFront OAC?

CloudFront OAC for Lambda works for GET requests but **does not support unsigned POST payloads**.
When a browser sends a POST, the body is unsigned. OAC signs the request headers but Lambda
rejects it with `InvalidSignatureException` because Lambda Function URLs require the payload
hash (`x-amz-content-sha256`) for POST/PUT.

Lambda@Edge solves this by running at the edge as an origin-request handler. It has access to
the full request body (`IncludeBody: true`), computes the payload hash, signs the entire request
with SigV4, and forwards it.

### Critical permission gotcha

The edge signer's role needs **both** permission types on the coordinator Lambda:
- `lambda:InvokeFunctionUrl` (resource-based policy: `EdgeSignerInvokePermission`)
- `lambda:InvokeFunction` (resource-based policy: `EdgeSignerInvokePermission2`)

**Both are required.** `InvokeFunctionUrl` alone produces `AccessDeniedException` even with a
valid SigV4 signature. See `template.yaml` lines 64–81.

---

## Prerequisites

- AWS CLI configured (`aws configure`)
- AWS SAM CLI installed (`brew install aws-sam-cli` or from aws.amazon.com/serverless/sam)
- Node.js 18+ and npm
- Python 3.13+

---

## Step 1 — Build and Deploy the Backend (Lambda + CloudFront)

```bash
cd 02-multi-agent/ui

# Build the SAM package
sam build

# First-time deploy (guided):
sam deploy --guided

# Subsequent deploys:
sam deploy
```

The deploy prints **Outputs** — copy them:

```
CloudFrontUrl           = https://xxxxxxxxxx.cloudfront.net
CloudFrontDistributionId = EXXXXXXXXX
FrontendBucketName      = claude-cert-multi-agent-frontend-123456789
```

---

## Step 2 — Build the Frontend

```bash
cd 02-multi-agent/ui/frontend
npm install
npm run build
# Output: frontend/dist/
```

---

## Step 3 — Upload Frontend to S3

```bash
# Hashed assets (JS/CSS) — long cache
aws s3 sync frontend/dist/ s3://claude-cert-multi-agent-frontend-123456789/ \
  --delete \
  --cache-control "max-age=31536000,immutable"

# index.html — never cache (SPA routing)
aws s3 cp frontend/dist/index.html \
  s3://claude-cert-multi-agent-frontend-123456789/index.html \
  --cache-control "no-cache,no-store,must-revalidate"
```

---

## Step 4 — Open the App

Visit the **CloudFrontUrl** from Step 1. Allow 2-5 minutes for CloudFront propagation on first deploy.

---

## Re-deploying After Code Changes

| Changed | Command |
|---------|---------|
| Backend Python | `sam build && sam deploy` |
| Frontend only  | `npm run build` in `frontend/`, then `aws s3 sync ...` |
| Both           | Run both sequences above |

After an S3 sync, invalidate CloudFront if changes aren't reflected:

```bash
aws cloudfront create-invalidation \
  --distribution-id EXXXXXXXXX \
  --paths "/*"
```

---

## Environment Variables (Lambda)

| Variable | SAM Parameter | Default | Description |
|----------|--------------|---------|-------------|
| `CLAUDE_MODEL` | `ClaudeModel` | `us.anthropic.claude-sonnet-4-6` | Bedrock cross-region inference profile |
| `REFUND_THRESHOLD` | `RefundThreshold` | `500` | $ threshold above which refunds are blocked by hook |
| `ANTHROPIC_API_KEY` | `AnthropicApiKey` | (empty) | Direct API key — leave blank if using Bedrock IAM role |
| `HUMAN_ESCALATION_EMAIL` | `HumanEscalationEmail` | `support@example.com` | Escalation ticket destination |

---

## Known Gotchas

1. **Custom error responses mask Lambda errors.** The SPA routing config (`403 → index.html`)
   applies globally to ALL origins. If the Lambda origin returns 403 (bad signature, wrong IAM),
   CloudFront silently replaces it with `index.html`. Temporarily remove custom error responses
   to see the real origin response when debugging.

2. **Lambda@Edge replica delay blocks stack deletion.** After undeploying, Lambda@Edge replicas
   take 1-24 hours to clean up. `sam delete` will fail on the edge function during this window.
   Use `--retain-resources EdgeSignerFunction` to skip it, then delete manually later.

3. **Coordinator timeout must match CloudFront.** The Lambda has a 120-second timeout. CloudFront's
   `OriginReadTimeout` is also set to 120 seconds in `template.yaml`. If you increase the Lambda
   timeout, update the CloudFront setting too — otherwise CloudFront closes the connection first
   and the browser gets a 504.

4. **Multi-agent runs need more memory.** Three parallel subagents run in separate Python threads.
   The Lambda is configured with 512 MB. If you hit memory errors on complex scenarios, increase
   `MemorySize` in `template.yaml`.

---

## Security Notes

- The Lambda Function URL has `AuthType: AWS_IAM` — **not publicly accessible** (direct calls get 403).
- API requests are authenticated by Lambda@Edge (SigV4 using its IAM role).
- The S3 bucket is private; only CloudFront can read from it (S3 OAC).
- The Lambda uses its IAM execution role to call Bedrock — no API keys required when using Bedrock.
