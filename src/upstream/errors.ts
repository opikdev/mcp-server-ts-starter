export type UpstreamErrorKind = 'timeout' | 'unreachable' | 'response' | 'credential';

export class UpstreamError extends Error {
  readonly kind: UpstreamErrorKind;
  readonly status: number | null;
  readonly retryAfterSeconds: number | null;

  constructor(
    message: string,
    kind: UpstreamErrorKind,
    status: number | null = null,
    retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.kind = kind;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const maxUntrustedLength = 500;

/** Caps upstream text and strips control characters, so it reaches the model as inert data. */
export function untrusted(text: string): string {
  const clean = text
    .replace(/[\p{Cc}\p{Cf}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const capped =
    clean.length > maxUntrustedLength ? `${clean.slice(0, maxUntrustedLength)}…` : clean;
  return JSON.stringify(capped);
}
