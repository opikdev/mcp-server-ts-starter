import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

function isTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function registerTimeTool(server: McpServer, now: () => Date) {
  server.registerTool(
    'get_time',
    {
      title: 'Get the current time',
      description: 'Returns the current date and time in an IANA time zone, such as Europe/Berlin.',
      inputSchema: z.object({
        timezone: z.string().default('UTC').describe('IANA time zone name. Defaults to UTC.'),
      }),
      outputSchema: z.object({ iso: z.string(), timezone: z.string(), local: z.string() }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ timezone }) => {
      if (!isTimeZone(timezone)) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Unknown time zone "${timezone}". Use an IANA name, such as Europe/Berlin.`,
            },
          ],
        };
      }
      const current = now();
      const local = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        dateStyle: 'full',
        timeStyle: 'long',
      }).format(current);
      const result = { iso: current.toISOString(), timezone, local };
      return {
        content: [{ type: 'text', text: `${local} (${timezone})` }],
        structuredContent: result,
      };
    },
  );
}
