import { randomUUID } from 'node:crypto';
import {
  type CallToolResult,
  type McpServer,
  requireScopes,
  type StandardSchemaWithJSON,
  type ToolCallback,
} from '@modelcontextprotocol/server';
import { metrics, SpanStatusCode, trace } from '@opentelemetry/api';
import type { Logger } from '../logger.ts';
import { UpstreamError } from '../upstream/errors.ts';
import type { NotesClient } from '../upstream/notes-client.ts';
import { serverName, serverVersion } from '../version.ts';

export interface ToolDeps {
  logger: Logger;
  now: () => Date;
  notes: NotesClient | null;
  transport: 'stdio' | 'http';
  allScopes: string[];
}

type UpstreamDeps = ToolDeps & { notes: NotesClient };

interface ToolSpec<In extends StandardSchemaWithJSON, Out extends StandardSchemaWithJSON, Deps> {
  name: string;
  scope?: string;
  title: string;
  description: string;
  inputSchema: In;
  outputSchema: Out;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
  handler: (deps: Deps) => ToolCallback<In>;
}

export interface Tool {
  name: string;
  scope: string | undefined;
  upstream: boolean;
  register(server: McpServer, deps: ToolDeps): void;
}

const tracer = trace.getTracer(serverName, serverVersion);

export function toolError(text: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text }] };
}

async function observe(name: string, logger: Logger, call: () => Promise<CallToolResult>) {
  const attributes = { 'mcp.method.name': 'tools/call', 'gen_ai.tool.name': name };
  const started = performance.now();
  return tracer.startActiveSpan(`tools/call ${name}`, { attributes }, async (span) => {
    let errorType: string | undefined;
    try {
      const result = await call();
      if (result.isError) errorType = 'tool_error';
      return result;
    } catch (error) {
      if (error instanceof UpstreamError) {
        errorType = `upstream_${error.kind}`;
        return toolError(error.message);
      }
      errorType = error instanceof Error ? error.name : 'unknown';
      span.recordException(error instanceof Error ? error : String(error));
      const errorId = randomUUID();
      logger.error({ err: error, errorId, tool: name }, 'Tool failed unexpectedly');
      return toolError(
        `The server failed unexpectedly. Report error ID ${errorId} to its operator.`,
      );
    } finally {
      if (errorType) {
        span.setAttribute('error.type', errorType);
        span.setStatus({ code: SpanStatusCode.ERROR });
      }
      span.end();
      metrics
        .getMeter(serverName, serverVersion)
        .createHistogram('mcp.server.operation.duration', {
          unit: 's',
          description: 'Duration of MCP tool calls',
        })
        .record((performance.now() - started) / 1000, {
          ...attributes,
          ...(errorType ? { 'error.type': errorType } : {}),
        });
    }
  });
}

/**
 * Defines a tool once: the registry derives scopes, upstream needs, and tool lists from it, and
 * every call gets a span, a duration metric, the scope challenge, and error handling.
 */
export function defineTool<In extends StandardSchemaWithJSON, Out extends StandardSchemaWithJSON>(
  spec: ToolSpec<In, Out, UpstreamDeps> & { upstream: true },
): Tool;
export function defineTool<In extends StandardSchemaWithJSON, Out extends StandardSchemaWithJSON>(
  spec: ToolSpec<In, Out, ToolDeps> & { upstream?: false },
): Tool;
export function defineTool<In extends StandardSchemaWithJSON, Out extends StandardSchemaWithJSON>({
  name,
  scope,
  upstream = false,
  handler,
  ...config
}: ToolSpec<In, Out, UpstreamDeps> & { upstream?: boolean }): Tool {
  return {
    name,
    scope,
    upstream,
    register(server, deps) {
      const callback = handler(deps as UpstreamDeps) as (
        ...args: unknown[]
      ) => Promise<CallToolResult>;
      server.registerTool(
        name,
        { ...config, ...(scope ? { scopeChallenge: requireScopes(scope) } : {}) },
        ((...args: unknown[]) =>
          observe(name, deps.logger, async () => callback(...args))) as ToolCallback<In>,
      );
    },
  };
}
