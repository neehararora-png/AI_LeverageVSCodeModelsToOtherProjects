# Installation

## Requirements
- Windows
- VS Code 1.90+
- Node.js 20+
- Local access to the workstation

## Setup
1. Clone the repository.
2. Open the project in VS Code.
3. Run `npm test` to confirm the repo guardrails.
4. Run **VS Code Bridge: Enable** from the Command Palette and review the modal consent prompt.
5. Run **VS Code Bridge: Copy Access Token** and set the copied value as `VSCODE_BROWSER_BRIDGE_TOKEN` for the trusted local client.
6. Use **VS Code Bridge: Stop** to stop listening, or **VS Code Bridge: Disable and Revoke Token** to stop and invalidate the credential.

## Security notes
The token is generated at runtime and stored in VS Code SecretStorage. It is copied to the clipboard only after the explicit copy command; do not paste it into source control, settings files, browser code, or logs. Bridge consent is stored per extension version and must be granted before the named pipe starts.
