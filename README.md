# VS Code Browser Bridge

A Windows-only VS Code extension that exposes a trusted local named-pipe interface for browser or script clients to access Copilot-backed language models without exposing a TCP port.

## Why a named pipe?
A browser cannot open a Windows named pipe. This prevents accidental network exposure and removes the usual CSRF and port-scanning assumptions from the trust model. The browser is intentionally outside the credential boundary: the local app holds the bearer token; the browser never does.

## Zero dependency posture
This repository intentionally avoids third-party dependencies, lockfiles, and package installs. The test run uses the Node.js built-in test runner only.

## Quick start
1. Open the project in VS Code.
2. Run the repo verification task.
3. Use the extension host and local client to start the named-pipe bridge.

## Development
- `npm test`
- `npm run verify`
- `python -m unittest discover -s clients/python -p "test_*.py"`
- `node scripts/forbidden-api-scan.js`
- `node scripts/secret-scan.js`

## Documentation index
- [PLAN.md](PLAN.md)
- [docs/API.md](docs/API.md)
- [docs/INSTALL.md](docs/INSTALL.md)
- [docs/SECURITY.md](docs/SECURITY.md)
- [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md)
