import {
  type McpServer,
  ResourceNotFoundError,
  ResourceTemplate,
} from '@modelcontextprotocol/server';

export interface Doc {
  slug: string;
  title: string;
  body: string;
}

export const docs: Doc[] = [
  {
    slug: 'getting-started',
    title: 'Getting started',
    body: 'Run the server over stdio with npx mcp-server-ts-starter, or over HTTP with --http. Tools live in src/tools, and each one has tests in test/.',
  },
  {
    slug: 'authentication',
    title: 'Authentication',
    body: 'Over HTTP, set MCP_AUTH_MODE to oauth to validate JWT access tokens from your authorization server, or to token for static bearer tokens. Over stdio, the client launches the server, so there is no token.',
  },
  {
    slug: 'adding-tools',
    title: 'Adding tools',
    body: 'Create a file in src/tools that registers the tool with an input schema, an output schema, and annotations, then add it to src/server.ts and write tests in test/integration.',
  },
];

export const docUri = (slug: string) => `docs://${slug}`;

export function registerDocs(server: McpServer) {
  server.registerResource(
    'docs',
    new ResourceTemplate('docs://{slug}', {
      list: () => ({
        resources: docs.map((doc) => ({
          uri: docUri(doc.slug),
          name: doc.slug,
          title: doc.title,
          mimeType: 'text/markdown',
        })),
      }),
    }),
    {
      title: 'Documentation',
      description: 'Short guides about this server.',
      mimeType: 'text/markdown',
    },
    (uri, { slug }) => {
      const doc = docs.find((candidate) => candidate.slug === slug);
      if (!doc) {
        throw new ResourceNotFoundError(
          uri.href,
          `No doc at ${uri.href}. List resources to see the available docs.`,
        );
      }
      return {
        contents: [
          { uri: uri.href, mimeType: 'text/markdown', text: `# ${doc.title}\n\n${doc.body}\n` },
        ],
      };
    },
  );
}
