# API Reference

The bridge is intentionally local-only and uses an authenticated named pipe. The browser or local app never receives a token, and the extension host holds the Copilot entitlement.

## Headers
Every request must include:

- Authorization: `Bearer <token>`
- X-Bridge-Client: client identifier
- X-Bridge-Nonce: unique value per request
- X-Bridge-Timestamp: current epoch milliseconds
- Content-Type: `application/json` for `POST`

## Endpoints

### GET /v1/health
Returns a JSON structure with service metadata and liveness fields.

### POST /v1/generate
Accepts a JSON object containing:

- model
- messages
- temperature (optional)
- maxInputTokens (optional)

The bridge may substitute a compatible model if the requested one is unavailable.

## Error model
Errors return a generic JSON payload with a non-revealing message and a numeric HTTP status.
