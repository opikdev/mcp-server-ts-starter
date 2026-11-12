import { z } from 'zod';
import { defineTool } from './tool.ts';

export const whoamiTool = defineTool({
  name: 'whoami',
  title: 'Who am I',
  description:
    'Returns how the caller is connected and, over HTTP, the authenticated client and its scopes.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    transport: z.enum(['stdio', 'http']),
    clientId: z.string().nullable(),
    scopes: z.array(z.string()),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler:
    ({ transport, allScopes }) =>
    async (_input, ctx) => {
      const authInfo = ctx.http?.authInfo;
      const result = {
        transport,
        clientId: authInfo?.clientId ?? null,
        scopes: authInfo?.scopes ?? allScopes,
      };
      const who = result.clientId ? `client ${result.clientId}` : 'an unauthenticated caller';
      return {
        content: [{ type: 'text', text: `Connected over ${transport} as ${who}.` }],
        structuredContent: result,
      };
    },
});
