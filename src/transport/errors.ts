export const OUTDATED_CLI_MESSAGE =
  'The installed obsidian-hybrid-search CLI is too old to report status. ' +
  'Update it with "npm install -g obsidian-hybrid-search", then reload the plugin. ' +
  'Search itself keeps working in the meantime.';

/**
 * A server without the status action does not recognise the request at all: it
 * falls through to the search schema and complains about a missing `query`.
 * Surfacing that raw is useless to the user, so it is translated here.
 */
export function isUnsupportedStatusError(message: string): boolean {
  return message.includes('stdio request') && message.includes('query');
}
