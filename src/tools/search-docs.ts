import { z } from 'zod';
import { type Doc, docs, docUri } from '../resources/docs.ts';
import { defineTool } from './tool.ts';

const snippetLength = 120;

function score(doc: Doc, terms: string[]): number {
  const title = doc.title.toLowerCase();
  const body = doc.body.toLowerCase();
  return terms.reduce(
    (total, term) => total + (title.includes(term) ? 3 : 0) + (body.includes(term) ? 1 : 0),
    0,
  );
}

export const searchDocsTool = defineTool({
  name: 'search_docs',
  title: 'Search the docs',
  description:
    'Searches this server’s documentation and returns the best matches, with links to read each one.',
  inputSchema: z.object({
    query: z.string().trim().min(1).max(200).describe('Words to search for.'),
    limit: z.number().int().min(1).max(10).default(3).describe('Maximum number of results.'),
  }),
  outputSchema: z.object({
    results: z.array(
      z.object({ slug: z.string(), title: z.string(), uri: z.string(), snippet: z.string() }),
    ),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler:
    () =>
    async ({ query, limit }) => {
      const terms = query.toLowerCase().split(/\s+/);
      const results = docs
        .map((doc) => ({ doc, score: score(doc, terms) }))
        .filter((match) => match.score > 0)
        .sort((a, b) => b.score - a.score || a.doc.slug.localeCompare(b.doc.slug))
        .slice(0, limit)
        .map(({ doc }) => ({
          slug: doc.slug,
          title: doc.title,
          uri: docUri(doc.slug),
          snippet: doc.body.slice(0, snippetLength),
        }));

      const summary =
        results.length === 0
          ? `No docs match "${query}".`
          : `Found ${results.length} doc(s) for "${query}".`;
      return {
        content: [
          { type: 'text', text: summary },
          ...results.map((result) => ({
            type: 'resource_link' as const,
            uri: result.uri,
            name: result.slug,
            title: result.title,
            mimeType: 'text/markdown',
          })),
        ],
        structuredContent: { results },
      };
    },
});
