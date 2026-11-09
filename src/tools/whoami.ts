import type { AuthInfo, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

export function registerWhoamiTool(
  server: McpServer,
  transport: 'stdio' | 'http',
  authInfo: AuthInfo | undefined,
) {
  server.registerTool(
    'whoami',
    {
      title: 'Who am I',
      description:
        'Returns how the caller is connected and, over HTTP, the authenticated client and its scopes.',
      inputSchema: z.object({}),
      outputSchema: z.object({
        transport: z.enum(['stdio', 'http']),
        clientId: z.string().nullable(),
        scopes: z.array(z.string()),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const result = {
        transport,
        clientId: authInfo?.clientId ?? null,
        scopes: authInfo?.scopes ?? [],
      };
      const who = result.clientId ? `client ${result.clientId}` : 'an unauthenticated caller';
      return {
        content: [{ type: 'text', text: `Connected over ${transport} as ${who}.` }],
        structuredContent: result,
      };
    },
  );
}
