import { NodeSDK } from '@opentelemetry/sdk-node';
import { serverName } from './version.ts';

/** Exports traces and metrics over OTLP, configured by the standard OTEL_* variables. */
export function startTelemetry(): () => Promise<void> {
  const sdk = new NodeSDK({ serviceName: process.env.OTEL_SERVICE_NAME ?? serverName });
  sdk.start();
  return () => sdk.shutdown();
}
