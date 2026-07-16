export type ProsperoErrorCode =
  | "CONFIG_ERROR"
  | "AUTH_REQUIRED"
  | "AUTH_EXPIRED"
  | "NETWORK_TIMEOUT"
  | "NETWORK_ERROR"
  | "SITE_UNAVAILABLE"
  | "HTTP_ERROR"
  | "INVALID_RESPONSE"
  | "NO_DRAFT"
  | "DRAFT_NOT_FOUND"
  | "DRAFT_SELECTION_REQUIRED"
  | "SITE_SCHEMA_CHANGED"
  | "VALIDATION_ERROR"
  | "WRITE_DISABLED"
  | "WRITE_CONFIRMATION_REQUIRED"
  | "UNSUPPORTED_FIELD"
  | "UNKNOWN_ERROR";

export interface ProsperoErrorShape {
  code: ProsperoErrorCode;
  message: string;
  retryable: boolean;
  action: string;
  details?: Record<string, unknown> | undefined;
}

export class ProsperoError extends Error {
  readonly code: ProsperoErrorCode;
  readonly retryable: boolean;
  readonly action: string;
  readonly details: Record<string, unknown> | undefined;

  constructor(shape: ProsperoErrorShape, options?: { cause?: unknown }) {
    super(shape.message, options);
    this.name = "ProsperoError";
    this.code = shape.code;
    this.retryable = shape.retryable;
    this.action = shape.action;
    this.details = shape.details;
  }

  toJSON(): ProsperoErrorShape {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      action: this.action,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

export function normalizeProsperoError(error: unknown): ProsperoError {
  if (error instanceof ProsperoError) return error;
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return new ProsperoError({
      code: "NETWORK_TIMEOUT",
      message: "PROSPERO did not respond before the configured timeout.",
      retryable: true,
      action: "Retry after PROSPERO recovers or increase PROSPERO_TIMEOUT_MS.",
    }, { cause: error });
  }
  if (error instanceof Error && /net::ERR_|fetch failed|network error/i.test(error.message)) {
    return new ProsperoError({
      code: "NETWORK_ERROR",
      message: "The PROSPERO network operation failed before a usable response was received.",
      retryable: true,
      action: "Check network access and retry after PROSPERO recovers.",
    }, { cause: error });
  }
  return new ProsperoError({
    code: "UNKNOWN_ERROR",
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
    action: "Inspect the sanitized error and retry only after correcting its cause.",
  }, { cause: error });
}
