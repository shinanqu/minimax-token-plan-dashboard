// Generic retry helper for transient network failures.
// Wraps an async function with exponential backoff + jitter and
// per-attempt AbortController-based timeout. Re-throws the last
// error after exhausting attempts so callers can map to user-friendly
// messages.

const TRANSIENT_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ECONNABORTED',
]);

const TRANSIENT_STATUS = new Set([500, 502, 503, 504, 429]);

function isTransientError(error) {
  if (!error) return false;
  if (error.code && TRANSIENT_CODES.has(error.code)) return true;
  if (error.syscall === 'getaddrinfo') return true;
  const status = error.response?.status;
  if (status && TRANSIENT_STATUS.has(status)) return true;
  return false;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jittered(ms) {
  // Symmetric jitter in [-100, +100], clamped at 0.
  const j = (Math.random() * 200) - 100;
  return Math.max(0, Math.floor(ms + j));
}

async function withRetry(fn, opts = {}) {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 300;
  const maxDelayMs = opts.maxDelayMs ?? 2000;
  const timeoutMs = opts.timeoutMs ?? 5000;

  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const result = await fn({ attempt, signal: controller.signal });
      clearTimeout(timer);
      return result;
    } catch (error) {
      clearTimeout(timer);
      lastError = error;

      const isLast = attempt >= maxAttempts;
      const transient = isTransientError(error);

      if (isLast || !transient) {
        throw error;
      }

      const expDelay = baseDelayMs * Math.pow(2, attempt - 1);
      const capped = Math.min(expDelay, maxDelayMs);
      const wait = jittered(capped);

      console.log(`[retry] attempt ${attempt}/${maxAttempts} after ${wait}ms: ${error.message}`);

      await delay(wait);
    }
  }

  throw lastError;
}

module.exports = { withRetry, isTransientError };
