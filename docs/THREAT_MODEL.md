# Threat Model

## Assets
- Copilot entitlement and billing exposure
- Prompt content that may be confidential
- The bridge token, which grants model access

## Trust boundaries

Browser (untrusted) -> no bridge credential
Local application (trusted) -> named pipe + bearer token
VS Code extension host -> `vscode.lm`

## What the named pipe does and does not buy
The bridge uses a named pipe rather than a TCP port so the browser is not exposed to arbitrary network attack paths. However, the pipe itself is not a full authorization boundary. Windows creates a pipe with a default read ACL for `WD` and `AN`, which allows local read access but does not grant write access to arbitrary users. The actual authorization boundary remains the bearer token and request validation.

## Threat table
| Threat | Treatment |
| --- | --- |
| Local page drives the bridge | Rejected via cookie/origin checks and token gate |
| Another local process sends requests | Requires the bridge token and local access |
| Token theft from disk | Stored only in the OS vault and not in the repo |
| Replay attack | Nonce and timestamp checks remain mandatory |
| Brute force | 256-bit token plus timing-safe comparison |
| Resource exhaustion | Rate limit + concurrency cap |
| Prompt exfiltration | Prompt logging disabled by default and redaction enabled |
| Dependency supply chain | No third-party dependencies |

## Residual risks
- A same-user process with local access to VS Code can still read the token if it already has the user’s trust boundary.
- The named pipe is not a general-purpose remote authorization control; it reduces network exposure but does not replace the token and request validation layer.
