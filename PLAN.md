# VS Code Browser Bridge — Execution Plan

## Purpose
This repository will implement a Windows-only VS Code extension that exposes Copilot-backed language-model access through a local named pipe rather than a TCP port. The design is deliberately conservative: no network egress, no outbound sockets, no dependencies, and no secrets in the repo.

## Ground Rules from the Source Brief
- Zero dependencies only; no package-lock, no node_modules, no third-party libraries.
- JavaScript + CommonJS only; every source file starts with `//@ts-check` and `"use strict"`.
- The bridge must run on Windows and use a named pipe for local trusted traffic.
- The bearer token is generated at runtime and stored only in VS Code SecretStorage.
- Security controls are not optional; they are part of the implementation contract and must be backed by tests.
- The build order is strict and must be followed in sequence.

## Review Passes

### Pass 1 — Structural Alignment
The first pass mapped the brief into a realistic delivery sequence:
1. Scaffold the repository and guardrails.
2. Add security validation scripts and repository invariants.
3. Implement the pipe config and transport foundation.
4. Add the security primitives and request validation.
5. Build HTTP request handling and Copilot integration.
6. Add audit, consent, and status surfaces.
7. Deliver Python client, docs, and final verification.

### Pass 2 — Security and Contract Tightening
The second pass tightened the plan around the actual module contracts and the 22 required controls:
- configuration settings validation with safe defaults and no permissive fallback
- named-pipe derivation with hostname hashing and strict regex validation
- authentication and replay protection before any work is done
- strict request parsing and schema rejection of unknown fields
- rate limiting and concurrency gating before resource-consuming work
- audit logging and non-leaky error responses
- no forbidden APIs, secret leakage, or outbound connections

### Pass 3 — Delivery-Ready Milestones
The final pass converts the architecture into execution checkpoints with explicit proof gates. The work is now split into milestone-driven steps so every change is validated before moving onward.

## Build Order and Milestones

### Milestone 1 — Foundational Scaffold
Target files:
- `package.json`
- `jsconfig.json`
- `.gitignore`
- `.vscode/extensions.json`
- `.vscode/launch.json`
- `.vscode/tasks.json`
- `.github/workflows/ci.yml`
- `LICENSE`

Deliverables:
- repo metadata aligned to the task
- Node 20+ project baseline
- CI workflow and VS Code task definitions
- no dependency declarations and no lockfile

Verification:
- `npm run verify`
- `node --test`
- repository invariant checks for required files and empty dependency state

### Milestone 2 — Guardrails and Negative Tests
Target files:
- `scripts/forbidden-api-scan.js`
- `scripts/secret-scan.js`
- `src/test/unit/test.js`

Deliverables:
- scanner for forbidden APIs and secrets
- tests that prove both positive and negative scan behavior
- CI enforcement against dependencies, lockfiles, and dangerous patterns

Verification:
- `npm run scan:forbidden`
- `npm run verify`
- `node --test`

### Milestone 3 — Config, Pipe Path, and Route Skeleton
Target files:
- `src/config/settings.js`
- `src/transport/pipePath.js`
- `src/dispatch/dispatch.js`
- `src/handlers/health.js`

Deliverables:
- safe default config values
- exact pipe-name validation and path derivation
- route handling for `404`/`405`
- health endpoint contract and error-shaping rules

Verification:
- unit tests for config and pipe-path logic
- request routing tests for missing and invalid paths

### Milestone 4 — Security Primitive Layer
Target files:
- `src/security/tokenManager.js`
- `src/security/authenticator.js`
- `src/security/guards.js`
- `src/security/rateLimiter.js`
- `src/security/redact.js`

Deliverables:
- 256-bit token generation in SecretStorage
- constant-time token compare and rotation semantics
- strict JSON parsing, bounded body handling, and unknown-field rejection
- token bucket + concurrency lease logic
- redaction of secret-like values from logs and error output

Verification:
- token rotation tests
- replay protection tests
- invalid JSON, oversized payload, and strict schema tests
- rate-limit/concurrency tests

### Milestone 5 — Named Pipe Transport
Target files:
- `src/transport/pipeServer.js`
- `src/transport/idleShutdown.js`
- `src/test/component/pipeServer.test.js`

Deliverables:
- HTTP server bound to a named pipe path
- slow-loris defenses via timeout settings
- idle shutdown handled cleanly
- single-instance detection / `EADDRINUSE` behavior
- real named-pipe component tests with Node HTTP client over a socket path

Verification:
- end-to-end tests for missing headers, wrong token, replayed nonce, invalid requests, and rate limiting
- server lifecycle tests for idle shutdown and conflict handling

### Milestone 6 — Request Handling and Copilot Integration
Target files:
- `src/handlers/generate.js`
- `src/lm/chatClient.js`
- `src/lm/selector.js`
- `src/extension.js`

Deliverables:
- proper guard order: route -> headers -> auth -> rate/concurrency -> read -> parse -> model check
- `vscode.lm` request wrapper with cancellation token semantics
- model selection with allowlist and safe fallback behavior
- extension activation/deactivation lifecycle and command registration

Verification:
- generate-handler tests for good and bad flows
- model-selector tests for family allowlisting and fallback
- extension lifecycle tests for clean activation/deactivation

### Milestone 7 — Consent, Audit, and UI
Target files:
- `src/consent/consentGate.js`
- `src/audit/auditLog.js`
- `src/ui/statusBar.js`

Deliverables:
- consent gate stored per extension version in GlobalState
- status states: off / listening / error
- bounded JSONL audit logs with request metadata
- prompt logging disabled by default and redacted when enabled

Verification:
- consent re-prompt behavior across version changes
- audit-log size and file limit behavior
- status bar transitions

### Milestone 8 — Documentation and Python Client
Target files:
- `README.md`
- `docs/API.md`
- `docs/INSTALL.md`
- `docs/MANUAL_VERIFICATION.md`
- `docs/SECURITY.md`
- `docs/THREAT_MODEL.md`
- `clients/python/bridge_client.py`
- `scripts/package-vsix.ps1`

Deliverables:
- user-facing docs for install, configuration, and troubleshooting
- explicit security table mapping each control to module and test
- threat model with measured claims and residual risks
- Python reference client that mirrors the pipe contract
- packaging script for a valid `.vsix` artifact without `vsce`

Verification:
- docs checked for consistency with code and tests
- Python client behavior validated against the contract
- package artifact created from the repository layout requirement

## Verification Cadence
The brief requires verification after each phase, not only at the end. The working rhythm is:
1. Add the minimal implementation for the phase.
2. Run all relevant focused tests.
3. Run `npm run verify`.
4. Only then proceed to the next milestone.

## Success Gates
The work is only complete once all of the following are true:
- `npm test` passes without external install or network access
- `npm run verify` passes with the guardrails active
- there are zero dependencies and no lockfiles
- all required files are present and all source files begin with the required header
- all 22 security controls are implemented and tied to a proving test
- docs describe the actual measured behavior, including pipe limitations and residual risk

## Risk Handling
The most important tradeoff is in the pipe itself: it prevents browser-driven requests by design, but it does not create a full authorization boundary by itself. The implementation must therefore rely on bearer-token validation, nonce/timestamp replay protection, and strict request validation as the actual enforcement layer. This is consistent with the brief and should be called out transparently in the threat model.

## Final Execution Note
This plan is intentionally ordered to keep the implementation conservative and reviewable. Each milestone is small enough that a reviewer can examine the repo as a whole without hidden “future work.” There are no placeholders and no deferred security controls.
