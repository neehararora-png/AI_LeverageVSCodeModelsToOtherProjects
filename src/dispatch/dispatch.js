//@ts-check
'use strict';

function buildErrorPayload(code, message, requestId = 'request') {
  return {
    ok: false,
    error: {
      code,
      message,
      requestId
    }
  };
}

async function dispatch(request, dependencies = {}) {
  const { handlers = {}, rateLimiter, authenticator, validateBody, logger } = dependencies;
  const method = String(request.method || 'GET').toUpperCase();
  const pathname = request.pathname || '/';
  const headers = request.headers || {};
  const requestId = request.requestId || 'request';

  if (pathname === '/' || pathname === '') {
    return { statusCode: 404, payload: buildErrorPayload('not_found', 'Not found.', requestId) };
  }

  if (!handlers[pathname]) {
    return { statusCode: 404, payload: buildErrorPayload('not_found', 'Not found.', requestId) };
  }

  if (method !== 'GET' && method !== 'POST') {
    return { statusCode: 405, headers: { Allow: 'GET, POST' }, payload: buildErrorPayload('method_not_allowed', 'Method not allowed.', requestId) };
  }

  if (headers.cookie || headers.Cookie || headers.origin || headers.Origin) {
    return { statusCode: 400, payload: buildErrorPayload('invalid_request', 'Request rejected.', requestId) };
  }

  if (!authenticator || typeof authenticator.authenticateRequest !== 'function') {
    return { statusCode: 401, payload: buildErrorPayload('unauthorized', 'Unauthorized.', requestId) };
  }

  const auth = await authenticator.authenticateRequest(headers, dependencies.expectedToken || '');
  if (!auth.ok) {
    return { statusCode: 401, payload: buildErrorPayload('unauthorized', 'Unauthorized.', requestId) };
  }

  if (typeof dependencies.onAuthenticatedRequest === 'function') {
    try {
      dependencies.onAuthenticatedRequest();
    } catch {
      // Activity tracking must not interrupt an authenticated request.
    }
  }

  if (rateLimiter && typeof rateLimiter.acquire === 'function') {
    const lease = rateLimiter.acquire();
    if (!lease.ok) {
      return { statusCode: 429, payload: buildErrorPayload('rate_limited', 'Too many requests.', requestId) };
    }
    request._lease = lease;
  }

  if (typeof request.readBody === 'function' && method === 'POST') {
    try {
      request.bodyText = await request.readBody();
    } catch (error) {
      if (request._lease && typeof request._lease.release === 'function') {
        request._lease.release();
      }
      const tooLarge = error && error.code === 'payload_too_large';
      return {
        statusCode: tooLarge ? 413 : 400,
        payload: buildErrorPayload(tooLarge ? 'payload_too_large' : 'invalid_request', 'Invalid request.', requestId)
      };
    }
  }

  if (request.bodyText && validateBody) {
    try {
      request.parsedBody = validateBody(request.bodyText);
    } catch (error) {
      if (request._lease && typeof request._lease.release === 'function') {
        request._lease.release();
      }
      const tooLarge = error && error.code === 'payload_too_large';
      return {
        statusCode: tooLarge ? 413 : 400,
        payload: buildErrorPayload(tooLarge ? 'payload_too_large' : 'invalid_request', 'Invalid request.', requestId)
      };
    }
  }

  try {
    if (method === 'POST' && validateBody && !request.parsedBody) {
      request.parsedBody = validateBody(request.bodyText || '');
    }
    const handler = handlers[pathname];
    const result = await handler({
      method,
      headers,
      body: request.parsedBody || {},
      requestId,
      logger,
      signal: request.signal
    });
    return {
      statusCode: result && result.statusCode ? result.statusCode : 200,
      payload: result && result.payload ? result.payload : result
    };
  } catch (error) {
    const modelUnavailable = error && error.code === 'model_unavailable';
    return {
      statusCode: modelUnavailable ? 503 : 500,
      payload: buildErrorPayload(modelUnavailable ? 'model_unavailable' : 'internal_error',
        modelUnavailable ? 'No compatible language model is available.' : 'Request could not be completed.', requestId)
    };
  } finally {
    if (request._lease && typeof request._lease.release === 'function') {
      request._lease.release();
    }
  }
}

module.exports = {
  buildErrorPayload,
  dispatch
};
