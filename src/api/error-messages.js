/**
 * Maps technical error objects to user-friendly messages.
 * Hides scary low-level details (e.g. `getaddrinfo ENOTFOUND ...`) from end users
 * while preserving actionable error text from the API layer.
 *
 * @param {Error|object|null|undefined} error
 * @returns {string} user-facing message; never throws, never returns undefined
 */
function toUserMessage(error) {
  if (!error) {
    return 'Request failed, please try again';
  }

  // 1. 401 — auth failure (matches existing behavior in minimax.js)
  if (error.response && error.response.status === 401) {
    return 'Invalid token or unauthorized.';
  }

  // 2. DNS / hostname resolution hiccup (the original bug)
  if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') {
    return 'Network temporarily unavailable';
  }

  // 3. Connection torn down before response
  if (error.code === 'ECONNRESET' || error.code === 'ECONNREFUSED') {
    return 'Connection lost, please retry';
  }

  // 4. Timeout (axios sets code; ECONNABORTED covers per-attempt timeout)
  if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
    return 'Request timed out';
  }

  // 5. Rate limit
  if (error.response && error.response.status === 429) {
    return 'Too many requests, please slow down';
  }

  // 6. Server-side failure (5xx) — anything else from the HTTP layer
  if (error.response && error.response.status >= 500 && error.response.status < 600) {
    return 'MiniMax server error, please try again';
  }

  // 7. Pass through API-level errors verbatim (status_code !== 0 envelope)
  if (typeof error.message === 'string' && error.message.startsWith('MiniMax API error')) {
    return error.message;
  }

  // 8. Pass through missing-credentials error verbatim
  if (typeof error.message === 'string' && error.message.startsWith('Missing credentials')) {
    return error.message;
  }

  // 9. Fallback — never leak the raw technical message
  return 'Request failed, please try again';
}

module.exports = { toUserMessage };
