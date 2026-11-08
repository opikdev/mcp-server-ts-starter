import { pino } from 'pino';

export function createLogger(level: string, destination = pino.destination(2)) {
  return pino(
    { level, redact: ['token', 'authorization', '*.token', '*.authorization'] },
    destination,
  );
}

export type Logger = ReturnType<typeof createLogger>;
