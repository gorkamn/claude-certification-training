/**
 * Lambda@Edge origin-request function.
 * Signs requests to the Lambda Function URL using SigV4 so the
 * Function URL can use AuthType: AWS_IAM while browsers POST normally.
 *
 * Based on: https://aws.amazon.com/blogs/compute/protecting-an-aws-lambda-function-url-with-amazon-cloudfront-and-lambdaedge/
 */
import { SignatureV4 } from '@smithy/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';

const REGION = 'us-east-1';
const credentialProvider = fromNodeProviderChain();

export const handler = async (event) => {
  const request = event.Records[0].cf.request;
  const host = request.origin.custom.domainName;

  // Reconstruct the body for POST/PUT requests
  let body = undefined;
  if (request.body && request.body.data) {
    body = request.body.encoding === 'base64'
      ? Buffer.from(request.body.data, 'base64').toString('utf-8')
      : request.body.data;
  }

  // Build minimal headers for signing — only include what's needed
  const headersToSign = {
    host: host,
  };

  // Include content-type if present (needed for POST)
  if (request.headers['content-type']) {
    headersToSign['content-type'] = request.headers['content-type'][0].value;
  }

  const signer = new SignatureV4({
    service: 'lambda',
    region: REGION,
    credentials: credentialProvider,
    sha256: Sha256,
  });

  const signed = await signer.sign({
    method: request.method,
    hostname: host,
    path: request.uri || '/',
    protocol: 'https:',
    headers: headersToSign,
    body: body,
  });

  // Apply the signed headers back to the CloudFront request
  // This adds Authorization, X-Amz-Date, X-Amz-Security-Token, etc.
  for (const [headerName, headerValue] of Object.entries(signed.headers)) {
    request.headers[headerName.toLowerCase()] = [{
      key: headerName,
      value: headerValue,
    }];
  }

  return request;
};
