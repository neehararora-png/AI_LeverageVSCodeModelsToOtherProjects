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

function dispatch(request, dependencies = {}) {
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

  const auth = authenticator.authenticateRequest(headers, dependencies.expectedToken || '');
  if (!auth.ok) {
    return { statusCode: 401, payload: buildErrorPayload('unauthorized', 'Unauthorized.', requestId) };
  }

  if (rateLimiter && typeof rateLimiter.acquire === 'function') {
    const lease = rateLimiter.acquire();
    if (!lease.ok) {
      return { statusCode: 429, payload: buildErrorPayload('rate_limited', 'Too many requests.', requestId) };
    }
    request._lease = lease;
  }

  if (request.bodyText && validateBody) {
    try {
      request.parsedBody = validateBody(request.bodyText);
    } catch (error) {
      if (request._lease && typeof request._lease.release === 'function') {
        request._lease.release();
      }
      return { statusCode: 400, payload: buildErrorPayload('invalid_request', 'Invalid request.', requestId) };
    }
  }

  const handler = handlers[pathname];
  const result = handler({ method, headers, body: request.parsedBody || {}, requestId, logger });

  if (request._lease && typeof request._lease.release === 'function') {
    request._lease.release();
  }

  return {
    statusCode: result && result.statusCode ? result.statusCode : 200,
    payload: result && result.payload ? result.payload : result
  };
}

module.exports = {
  buildErrorPayload,
  dispatch
};
