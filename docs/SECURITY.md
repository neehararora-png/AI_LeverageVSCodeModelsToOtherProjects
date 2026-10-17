# Security Review

## Security controls and proving tests

| Control | Module | Proof test |
| --- | --- | --- |
| Default-disabled operation | `src/config/settings.js` | `src/test/unit/test.test.js` |
| Safe pipe-name derivation | `src/transport/pipePath.js` | `src/test/unit/test.test.js` |
| 256-bit token generation | `src/security/tokenManager.js` | `src/test/unit/test.test.js` |
| Constant-time verification | `src/security/tokenManager.js` | `src/test/unit/test.test.js` |
| Strict JSON parsing | `src/security/guards.js` | `src/test/unit/test.test.js` |
| Body-size enforcement | `src/security/guards.js` | `src/test/unit/test.test.js` |
| Unknown-field rejection | `src/security/guards.js` | `src/test/unit/test.test.js` |
| Token bucket + concurrency | `src/security/rateLimiter.js` | `src/test/unit/test.test.js` |
| Consent gate | `src/consent/consentGate.js` | `src/test/unit/test.test.js` |
| Status visibility | `src/ui/statusBar.js` | `src/test/unit/test.test.js` |
| Audit logging | `src/audit/auditLog.js` | `src/test/unit/test.test.js` |
| Secret redaction | `src/security/redact.js` | `src/test/unit/test.test.js` |
| Route/auth ordering | `src/dispatch/dispatch.js` | `src/test/unit/test.test.js` |
| Pipe server lifecycle | `src/transport/pipeServer.js` | `src/test/component/pipeServer.test.js` |

## Security posture

The bridge intentionally keeps the browser or arbitrary local page outside the credential boundary. The local application bears the token, while the model access remains inside the VS Code trust boundary.

Starting the named pipe requires a versioned modal bridge-consent decision. Each model generation also requires explicit user approval; prompt content is not displayed in the approval dialog. The access token stays in VS Code SecretStorage and is copied only through the explicit copy-token command. Disabling the bridge stops the server, records revoked consent, and deletes the stored token.

This project avoids third-party packages and does not place secrets in the repository. The implementation also rejects dangerous APIs and blocks secret-like material in logs.
