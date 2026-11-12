import { createNoteTool } from './create-note.ts';
import { listNotesTool } from './list-notes.ts';
import { searchDocsTool } from './search-docs.ts';
import { timeTool } from './time.ts';
import type { Tool } from './tool.ts';
import { whoamiTool } from './whoami.ts';

export const tools: Tool[] = [timeTool, searchDocsTool, whoamiTool, listNotesTool, createNoteTool];

export function enabledTools(upstream: boolean): Tool[] {
  return tools.filter((tool) => upstream || !tool.upstream);
}

/** Every scope a caller can hold: the base scopes, plus each enabled tool's own scope. */
export function supportedScopes(baseScopes: string[], upstream: boolean): string[] {
  const toolScopes = enabledTools(upstream).flatMap((tool) => (tool.scope ? [tool.scope] : []));
  return [...new Set([...baseScopes, ...toolScopes])];
}
