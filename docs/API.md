# API Reference

The bridge is intentionally local-only and uses an authenticated named pipe. The trusted local application receives the bearer token only through the explicit copy command; browser code never receives it, and the extension host holds the Copilot entitlement.

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

### GET /v1/models
Returns the models available through VS Code that match the configured allowed model families.

### POST /v1/generate
Accepts a JSON object containing:

- model
- messages
- temperature (optional)
- maxInputTokens (optional)

The bridge may substitute a compatible model if the requested one is unavailable.
Request bodies are limited to 256 KiB and must use `Content-Type: application/json`.
The concurrency slot remains held until model generation completes.
In the VS Code extension, each generation request requires an explicit modal approval before prompt content is sent to a language model. Denied requests return `403 model_request_denied`. The approval wait and model call are bounded by the configured request timeout and cancelled if the local client disconnects.

If no language-model client is available, this endpoint returns `503 model_unavailable`; it never fabricates a successful model response.

## Error model
Errors return a generic JSON payload with a non-revealing message and a numeric HTTP status. Supported statuses include `400` for invalid input, `401` for failed authentication, `403` for a user-denied model request, `404` for unknown routes, `405` for an unsupported method, `413` for an oversized body, `429` for rate or concurrency limits, `499` when the client disconnects, `503` when no model is available, and `504` when model generation times out.
