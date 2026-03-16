import type { AuthSessionManager } from "../auth/auth-session.js";

export type PluginPromptMap = Record<string, string>;

const PLUGIN_PROMPTS_QUERY = `
  query PluginPrompts {
    pluginPrompts {
      pluginId
      prompt
    }
  }
`;

/**
 * Fetch server-managed plugin prompts and return as a pluginId -> prompt map.
 * Returns empty map on failure (graceful degradation — plugins fall back to empty prompt).
 */
export async function fetchPluginPrompts(
  authSession: AuthSessionManager,
): Promise<PluginPromptMap> {
  try {
    const result = await authSession.graphqlFetch<{
      pluginPrompts: Array<{ pluginId: string; prompt: string }>;
    }>(PLUGIN_PROMPTS_QUERY, {});

    const map: PluginPromptMap = {};
    for (const { pluginId, prompt } of result.pluginPrompts) {
      map[pluginId] = prompt;
    }
    return map;
  } catch {
    // Graceful degradation: if server is unreachable or user not authenticated,
    // plugins will use empty prompt (no sensitive content leaked in open-source code).
    return {};
  }
}
