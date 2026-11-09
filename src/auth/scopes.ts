import type { AuthInfo, CallToolResult } from '@modelcontextprotocol/server';
import { toolError } from '../tool-errors.ts';

export function requireScope(
  authInfo: AuthInfo | undefined,
  scope: string,
  action: string,
): CallToolResult | undefined {
  if (!authInfo || authInfo.extra?.allScopes === true || authInfo.scopes.includes(scope)) {
    return undefined;
  }
  return toolError(`This token lacks the ${scope} scope. Reconnect with that scope to ${action}.`);
}
