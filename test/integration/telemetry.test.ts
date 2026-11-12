import {
  AggregationTemporality,
  type DataPoint,
  type Histogram,
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTokenVerifier } from '../../src/auth/token.ts';
import { createHttpApp } from '../../src/http/app.ts';
import {
  capturingLogger,
  config,
  connect,
  devToken,
  everyScope,
  fakeNotes,
  track,
} from '../helpers.ts';

interface ExportedSpan {
  name: string;
  attributes: Record<string, unknown>;
  status: { code: number };
  spanContext(): { traceId: string; spanId: string };
}

const spans: ExportedSpan[] = [];
const exporter = {
  export(batch: ExportedSpan[], done: (result: { code: number }) => void) {
    spans.push(...batch);
    done({ code: 0 });
  },
  async shutdown() {},
};

const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
let sdk: NodeSDK;

beforeAll(() => {
  process.env.OTEL_LOGS_EXPORTER = 'none';
  sdk = new NodeSDK({
    serviceName: 'telemetry-test',
    traceExporter: exporter as never,
    metricReaders: [new PeriodicExportingMetricReader({ exporter: metricExporter })],
  });
  sdk.start();
});

afterAll(async () => {
  delete process.env.OTEL_LOGS_EXPORTER;
});

function histogram(name: string): DataPoint<Histogram>[] {
  return metricExporter
    .getMetrics()
    .flatMap((resource) => resource.scopeMetrics)
    .flatMap((scope) => scope.metrics)
    .filter((metric) => metric.descriptor.name === name)
    .flatMap((metric) => metric.dataPoints as DataPoint<Histogram>[]);
}

describe('with an OTLP endpoint set', () => {
  it('traces and measures HTTP requests and tool calls, and propagates the trace upstream and into logs', async () => {
    const { logger, logs } = capturingLogger();
    const notes = fakeNotes();
    const cfg = config({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318' });
    const http = track(
      createHttpApp({
        config: cfg,
        logger,
        verifier: createTokenVerifier([devToken], everyScope),
        notes: notes.notes,
      }),
    );
    const client = await connect(http, cfg.publicUrl, { token: devToken });
    expect((await client.callTool({ name: 'list_notes', arguments: {} })).isError).toBeFalsy();
    await client.callTool({ name: 'get_time', arguments: { timezone: 'Mars/Olympus' } });
    await sdk.shutdown();

    const tool = spans.find((span) => span.name === 'tools/call list_notes');
    expect(tool?.attributes).toMatchObject({
      'mcp.method.name': 'tools/call',
      'gen_ai.tool.name': 'list_notes',
    });
    const traceId = tool?.spanContext().traceId;
    expect(
      spans.some((span) => span.name.startsWith('POST') && span.spanContext().traceId === traceId),
    ).toBe(true);

    const failed = spans.find((span) => span.name === 'tools/call get_time');
    expect(failed?.attributes['error.type']).toBe('tool_error');
    expect(failed?.status.code).toBe(2);

    const traceparent = notes.api.requests[0]?.headers.get('traceparent');
    expect(traceparent).toMatch(new RegExp(`^00-${traceId}-[0-9a-f]{16}-01$`));

    const toolCalls = histogram('mcp.server.operation.duration');
    expect(toolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attributes: { 'mcp.method.name': 'tools/call', 'gen_ai.tool.name': 'list_notes' },
          value: expect.objectContaining({ count: 1 }),
        }),
        expect.objectContaining({
          attributes: {
            'mcp.method.name': 'tools/call',
            'gen_ai.tool.name': 'get_time',
            'error.type': 'tool_error',
          },
          value: expect.objectContaining({ count: 1 }),
        }),
      ]),
    );
    expect(histogram('http.server.request.duration').length).toBeGreaterThan(0);

    const access = logs()
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
      .filter((entry) => entry.msg === 'HTTP request');
    expect(access.length).toBeGreaterThan(0);
    for (const entry of access) {
      expect(entry).toMatchObject({
        trace_id: expect.stringMatching(/^[0-9a-f]{32}$/),
        span_id: expect.stringMatching(/^[0-9a-f]{16}$/),
      });
    }
  });
});
