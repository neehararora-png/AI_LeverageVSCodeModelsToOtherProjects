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
Request bodies are limited to 256 KiB and must use `Content-Type: application/json`.
The concurrency slot remains held until model generation completes.

If no language-model client is available, this endpoint returns `503 model_unavailable`; it never fabricates a successful model response.

## Error model
Errors return a generic JSON payload with a non-revealing message and a numeric HTTP status. Supported statuses include `400` for invalid input, `401` for failed authentication, `404` for unknown routes, `405` for an unsupported method, `413` for an oversized body, `429` for rate or concurrency limits, and `503` when no model is available.
