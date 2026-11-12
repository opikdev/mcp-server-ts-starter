import { isSpanContextValid, trace } from '@opentelemetry/api';
import { type DestinationStream, pino } from 'pino';

function traceContext() {
  const span = trace.getActiveSpan()?.spanContext();
  return span && isSpanContextValid(span) ? { trace_id: span.traceId, span_id: span.spanId } : {};
}

export function createLogger(level: string, destination: DestinationStream = pino.destination(2)) {
  return pino(
    {
      level,
      redact: ['token', 'authorization', '*.token', '*.authorization'],
      mixin: traceContext,
    },
    destination,
  );
}

export type Logger = ReturnType<typeof createLogger>;
