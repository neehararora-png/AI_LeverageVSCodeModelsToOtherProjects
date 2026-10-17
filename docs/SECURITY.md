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

This project avoids third-party packages and does not place secrets in the repository. The implementation also rejects dangerous APIs and blocks secret-like material in logs.
