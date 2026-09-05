/**
 * LLM Error Classification and Retry Logic
 *
 * Classifies API errors into actionable types and provides
 * exponential backoff retry for transient failures.
 */

export enum LLMErrorType {
  RATE_LIMIT = "rate_limit",
  OVERLOADED = "overloaded",
  AUTH = "auth",
  NETWORK = "network",
  INVALID_REQUEST = "invalid_request",
  UNKNOWN = "unknown",
}

const NETWORK_PATTERNS = [
  "fetch failed",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "network",
  "socket hang up",
];

/**
 * Classify an LLM API error into a typed category.
 */
export function classifyLLMError(err: unknown): LLMErrorType {
  if (!err) return LLMErrorType.UNKNOWN;

  const errObj = err as Record<string, unknown>;
  const status = (errObj?.status as number) ?? (errObj?.statusCode as number);
  const message = err instanceof Error ? err.message : String(err);
  const code = errObj?.code as string | undefined;

  // Status-based classification
  if (
    status === 429 ||
    message.includes("rate limit") ||
    message.includes("429")
  ) {
    return LLMErrorType.RATE_LIMIT;
  }
  if (status === 529 || status === 503) {
    return LLMErrorType.OVERLOADED;
  }
  if (status === 401 || status === 403) {
    return LLMErrorType.AUTH;
  }
  if (status === 400) {
    return LLMErrorType.INVALID_REQUEST;
  }

  // Code-based classification
  if (code && NETWORK_PATTERNS.some((p) => code.includes(p))) {
    return LLMErrorType.NETWORK;
  }

  // Message-based classification
  const lowerMsg = message.toLowerCase();
  if (NETWORK_PATTERNS.some((p) => lowerMsg.includes(p.toLowerCase()))) {
    return LLMErrorType.NETWORK;
  }

  return LLMErrorType.UNKNOWN;
}

/**
 * Whether an error type is transient and worth retrying.
 */
export function isRetryable(errorType: LLMErrorType): boolean {
  return (
    errorType === LLMErrorType.RATE_LIMIT ||
    errorType === LLMErrorType.OVERLOADED ||
    errorType === LLMErrorType.NETWORK
  );
}

interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
}

/**
 * Retry a function with exponential backoff for transient errors.
 * Non-retryable errors (auth, invalid request) throw immediately.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const { maxRetries, baseDelayMs } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const errorType = classifyLLMError(err);

      // Don't retry non-transient errors
      if (!isRetryable(errorType)) {
        throw err;
      }

      // Don't retry if we've exhausted retries
      if (attempt >= maxRetries) {
        throw err;
      }

      // Exponential backoff with jitter
      const delay =
        baseDelayMs * Math.pow(2, attempt) + Math.random() * baseDelayMs;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
