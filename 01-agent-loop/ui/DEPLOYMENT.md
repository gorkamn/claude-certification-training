# Deployment Guide — TechCo Support Agent Demo UI

## Architecture

```
Browser → CloudFront (https://xxxxx.cloudfront.net)
  ├── /*     → S3 origin (OAC-signed) — React static app
  └── /api*  → Lambda@Edge (SigV4 signer) → Lambda Function URL (AuthType: AWS_IAM)
```

The frontend is a static React app served from S3+CloudFront. When the user runs a scenario, the browser POSTs to `/api` (same CloudFront domain — no CORS needed). A Lambda@Edge function intercepts the origin request, signs it with SigV4 using its IAM role credentials, and forwards it to the Lambda Function URL. The Function URL uses `AuthType: AWS_IAM` so it is never directly accessible from the internet.

There is no API Gateway — the Function URL avoids the 29-second timeout which matters for multi-iteration agent runs.

### Why Lambda@Edge instead of CloudFront OAC?

CloudFront OAC for Lambda works for GET requests but **does not support unsigned POST payloads**. When a browser sends a POST, the body is unsigned. OAC signs the request headers but Lambda rejects it with `InvalidSignatureException` because Lambda Function URLs require the payload hash (`x-amz-content-sha256`) for POST/PUT. The browser cannot compute SigV4 signatures.

Lambda@Edge solves this by running at the edge as an origin-request handler. It has access to the full request body (`IncludeBody: true`), computes the payload hash, signs the entire request with SigV4, and forwards it. The Lambda Function URL sees a properly signed IAM request and accepts it.

### Debugging gotchas we hit along the way

1. **Custom error responses mask Lambda errors.** The SPA routing config (`403 → index.html`) applies globally to ALL origins, not just S3. If the Lambda origin returns 403 (e.g., bad signature), CloudFront silently replaces it with `index.html`. When debugging API routing, temporarily remove custom error responses to see the real origin response.

2. **CloudFront OAC + Lambda POST = `InvalidSignatureException`.** This is an AWS limitation, not a misconfiguration. The AWS docs state: "If you use PUT or POST methods with your Lambda function URL, your users must compute the SHA256 of the body and include the payload hash value in the `x-amz-content-sha256` header." Browsers can't do this. Use Lambda@Edge instead.

3. **Lambda@Edge needs BOTH identity-based AND resource-based policies.** The edge signer's IAM role needs `lambda:InvokeFunctionUrl` + `lambda:InvokeFunction` (identity-based). The target Lambda also needs `AWS::Lambda::Permission` entries granting the edge signer's role both actions (resource-based). Missing either side produces `AccessDeniedException`.

4. **Don't use IAM conditions on the edge signer policy.** Adding `Condition: { StringEquals: { lambda:FunctionUrlAuthType: AWS_IAM } }` to the edge signer's IAM policy causes `AccessDeniedException` even though it looks correct. Remove the condition — scope by resource ARN instead.

5. **Lambda@Edge replicas block stack deletion.** Lambda@Edge functions are replicated to edge locations. After removing the edge association from CloudFront, AWS takes 1-24 hours to clean up replicas. During this time, `sam delete` or `cloudformation delete-stack` will fail on the edge function. Use `--retain-resources` to skip it, then delete manually later.

6. **`AuthType: NONE` triggers Palisade/AppSec findings.** Even with a shared-secret header check in the Lambda handler, Palisade flags the Function URL as world-accessible because the resource policy allows `Principal: *`. The only way to clear the finding is `AuthType: AWS_IAM` with no public invoke permissions.

---

## Prerequisites

- AWS CLI configured (`aws configure`)
- AWS SAM CLI installed (`brew install aws-sam-cli` or from aws.amazon.com/serverless/sam)
- Node.js 18+ and npm
- Python 3.11+
- Bedrock model access enabled in your AWS account (Bedrock console → Model access → enable Claude models)

---

## Step 1 — Build and Deploy the Backend (Lambda + CloudFront)

```bash
cd demo-ui

# Build the SAM package (installs Python dependencies into the Lambda package)
sam build

# Deploy (first time: guided setup)
sam deploy --guided

# Subsequent deploys:
sam deploy
```

The deploy will print two **Outputs** — copy them:

```
CloudFrontDomain    = https://xxxxxxxxxx.cloudfront.net
FrontendBucketName  = claude-cert-demo-frontend-123456789
```

---

## Step 2 — Build the Frontend

The frontend uses a relative path `/api` — no environment variable needed, it resolves to the same CloudFront domain.

```bash
cd demo-ui/frontend
npm install
npm run build
# Output goes to: frontend/dist/
```

---

## Step 3 — Upload Frontend to S3

```bash
# Use the bucket name from Step 1 outputs
aws s3 sync frontend/dist/ s3://claude-cert-demo-frontend-123456789/ \
  --delete \
  --cache-control "max-age=31536000,immutable"

# index.html should NOT be cached (SPA routing)
aws s3 cp frontend/dist/index.html s3://claude-cert-demo-frontend-123456789/index.html \
  --cache-control "no-cache,no-store,must-revalidate"
```

---

## Step 4 — Open the App

Visit the **CloudFrontDomain** URL from Step 1. CloudFront may take 2-5 minutes to propagate on first deploy.

```
https://xxxxxxxxxx.cloudfront.net
```

---

## Local Development

```bash
# Terminal 1 — frontend dev server
cd demo-ui/frontend
npm install
npm run dev
# → http://localhost:5173
```

The dev server proxies `/api` requests — add a `vite.config.js` proxy entry pointing to a locally running Lambda (`sam local start-api`) if you want to run scenarios locally. Or skip the backend and the UI will show errors only when "Run Scenario" is clicked.

---

## Re-deploying After Code Changes

| Changed | Command |
|---------|---------|
| Backend Python | `sam build && sam deploy` |
| Frontend only  | `npm run build` in `frontend/`, then `aws s3 sync ...` |
| Both           | Run both sequences above |

After an S3 sync, invalidate the CloudFront cache if changes aren't reflected:

```bash
aws cloudfront create-invalidation \
  --distribution-id EXXXXXXXXX \
  --paths "/*"
```

(Find your distribution ID with `aws cloudfront list-distributions`)

---

## Environment Variables

| Variable | Where set | Description |
|----------|-----------|-------------|
| `CLAUDE_MODEL` | Lambda env (SAM parameter) | Bedrock cross-region inference profile ID (default: `us.anthropic.claude-sonnet-4-6`) |
| `REFUND_THRESHOLD` | Lambda env | Refund block threshold in $ (default: `500`) |

---

## Security Notes

- The Lambda Function URL has `AuthType: AWS_IAM` — it is **not publicly accessible**. Direct calls return `403 Forbidden`.
- API requests are authenticated by a Lambda@Edge function that signs them with SigV4 using its IAM role. The edge signer's role is scoped to only invoke this specific Lambda function.
- The S3 bucket is private; only CloudFront can read from it (S3 OAC).
- The Lambda uses its IAM execution role to call Bedrock — no API keys required.