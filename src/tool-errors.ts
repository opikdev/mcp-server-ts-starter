import { randomUUID } from 'node:crypto';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { Logger } from './logger.ts';
import { UpstreamError } from './upstream/notes-client.ts';

export function toolError(text: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text }] };
}

export function catchToolErrors<Args extends unknown[]>(
  logger: Logger,
  handler: (...args: Args) => Promise<CallToolResult>,
) {
  return async (...args: Args): Promise<CallToolResult> => {
    try {
      return await handler(...args);
    } catch (error) {
      if (error instanceof UpstreamError) return toolError(error.message);
      const errorId = randomUUID();
      logger.error({ err: error, errorId }, 'Tool failed unexpectedly');
      return toolError(
        `The server failed unexpectedly. Report error ID ${errorId} to its operator.`,
      );
    }
  };
}
