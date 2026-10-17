# Manual Verification

This checklist records the minimum manual review that should be performed on a local Windows workstation.

## Verify repository guardrails
- `npm run verify`
- Confirm no dependency files or lockfiles exist.
- Confirm the scan rejects forbidden APIs and secret material.

## Verify safe configuration
- Disable the bridge by default.
- Validate the pipe name accepts only `A-Za-z0-9_-` characters.
- Confirm malformed pipe names fall back to the safe default.

## Verify a warm start
- Start the bridge in VS Code.
- Confirm the status bar reports `listening`.
- Confirm the HTTP endpoint responds without exposing stack traces or internal details.

## Verify security posture
- Attempt a request without the bearer token.
- Attempt a mutated or replayed nonce.
- Confirm the client receives a generic error object.
