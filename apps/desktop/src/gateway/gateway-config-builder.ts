import { join } from "node:path";
import type { LLMProvider } from "@easyclaw/core";
import { resolveModelConfig, LOCAL_PROVIDER_IDS, getProviderMeta, resolveGatewayPort } from "@easyclaw/core";
import { buildExtraProviderConfigs, writeGatewayConfig } from "@easyclaw/gateway";
import type { Storage } from "@easyclaw/storage";
import type { SecretStore } from "@easyclaw/secrets";
import { buildOwnerAllowFrom } from "../auth/owner-sync.js";
import type { AuthSessionManager } from "../auth/auth-session.js";

export interface GatewayConfigDeps {
  storage: Storage;
  secretStore: SecretStore;
  locale: string;
  configPath: string;
  stateDir: string;
  extensionsDir: string;
  sttCliPath: string;
  filePermissionsPluginPath?: string;
  authSession?: AuthSessionManager;
}

/**
 * Create gateway config builder functions bound to the given dependencies.
 * Returns closures that can be called without passing deps each time.
 */
export function createGatewayConfigBuilder(deps: GatewayConfigDeps) {
  const { storage, secretStore, locale, configPath, stateDir, extensionsDir, sttCliPath, filePermissionsPluginPath, authSession } = deps;

  function isGeminiOAuthActive(): boolean {
    return storage.providerKeys.getAll()
      .some((k) => k.provider === "gemini" && k.authType === "oauth" && k.isDefault);
  }

  function resolveGeminiOAuthModel(provider: string, modelId: string): { provider: string; modelId: string } {
    if (!isGeminiOAuthActive() || provider !== "gemini") {
      return { provider, modelId };
    }
    return { provider: "google-gemini-cli", modelId };
  }

  function buildLocalProviderOverrides(): Record<string, { baseUrl: string; models: Array<{ id: string; name: string; inputModalities?: string[] }> }> {
    const overrides: Record<string, { baseUrl: string; models: Array<{ id: string; name: string; inputModalities?: string[] }> }> = {};
    for (const localProvider of LOCAL_PROVIDER_IDS) {
      const activeKey = storage.providerKeys.getByProvider(localProvider)[0];
      if (!activeKey) continue;
      const meta = getProviderMeta(localProvider);
      let baseUrl = activeKey.baseUrl || meta?.baseUrl || "http://localhost:11434/v1";
      if (!baseUrl.match(/\/v\d\/?$/)) {
        baseUrl = baseUrl.replace(/\/+$/, "") + "/v1";
      }
      const modelId = activeKey.model;
      if (modelId) {
        overrides[localProvider] = {
          baseUrl,
          models: [{ id: modelId, name: modelId, inputModalities: activeKey.inputModalities ?? undefined }],
        };
      }
    }
    return overrides;
  }

  function buildCustomProviderOverrides(): Record<string, { baseUrl: string; api: string; models: Array<{ id: string; name: string; input?: Array<"text" | "image"> }> }> {
    const overrides: Record<string, { baseUrl: string; api: string; models: Array<{ id: string; name: string; input?: Array<"text" | "image"> }> }> = {};
    const allKeys = storage.providerKeys.getAll();
    const customKeys = allKeys.filter((k) => k.authType === "custom");

    for (const key of customKeys) {
      if (!key.baseUrl || !key.customModelsJson || !key.customProtocol) continue;
      let models: string[];
      try { models = JSON.parse(key.customModelsJson); } catch { continue; }
      const api = key.customProtocol === "anthropic" ? "anthropic-messages" : "openai-completions";
      const input = (key.inputModalities ?? ["text"]) as Array<"text" | "image">;
      overrides[key.provider] = {
        baseUrl: key.baseUrl,
        api,
        models: models.map((m) => ({ id: m, name: m, input })),
      };
    }
    return overrides;
  }

  const WS_ENV_MAP: Record<string, string> = {
    brave: "EASYCLAW_WS_BRAVE_APIKEY",
    perplexity: "EASYCLAW_WS_PERPLEXITY_APIKEY",
    grok: "EASYCLAW_WS_GROK_APIKEY",
    gemini: "EASYCLAW_WS_GEMINI_APIKEY",
    kimi: "EASYCLAW_WS_KIMI_APIKEY",
  };
  const EMB_ENV_MAP: Record<string, string> = {
    openai: "EASYCLAW_EMB_OPENAI_APIKEY",
    gemini: "EASYCLAW_EMB_GEMINI_APIKEY",
    voyage: "EASYCLAW_EMB_VOYAGE_APIKEY",
    mistral: "EASYCLAW_EMB_MISTRAL_APIKEY",
  };

  async function buildFullGatewayConfig(): Promise<Parameters<typeof writeGatewayConfig>[0]> {
    const activeKey = storage.providerKeys.getActive();
    const curProvider = activeKey?.provider as LLMProvider | undefined;
    const curRegion = storage.settings.get("region") ?? (locale === "zh" ? "cn" : "us");
    const curModelId = activeKey?.model;
    const curModel = resolveModelConfig({
      region: curRegion,
      userProvider: curProvider,
      userModelId: curModelId,
    });

    const curSttEnabled = storage.settings.get("stt.enabled") === "true";
    const curSttProvider = (storage.settings.get("stt.provider") || "groq") as "groq" | "volcengine";

    const curWebSearchEnabled = storage.settings.get("webSearch.enabled") === "true";
    const curWebSearchProvider = (storage.settings.get("webSearch.provider") || "brave") as "brave" | "perplexity" | "grok" | "gemini" | "kimi";

    const curEmbeddingEnabled = storage.settings.get("embedding.enabled") === "true";
    const curEmbeddingProvider = (storage.settings.get("embedding.provider") || "openai") as "openai" | "gemini" | "voyage" | "mistral" | "ollama";

    const curBrowserMode = (storage.settings.get("browser-mode") || "standalone") as "standalone" | "cdp";
    const curBrowserCdpPort = parseInt(storage.settings.get("browser-cdp-port") || "9222", 10);

    // Only reference apiKey env var if key exists in keychain
    const wsKeyExists = curWebSearchEnabled
      ? !!(await secretStore.get(`websearch-${curWebSearchProvider}-apikey`))
      : false;
    const embKeyExists = curEmbeddingEnabled && curEmbeddingProvider !== "ollama"
      ? !!(await secretStore.get(`embedding-${curEmbeddingProvider}-apikey`))
      : false;

    // Simplified: just pass static defaults. Per-run prompt addendum and
    // tool gating are handled by the plugin's own hooks at runtime.
    const browserProfilesEnabled = !!authSession?.getAccessToken();

    return {
      configPath,
      gatewayPort: resolveGatewayPort(),
      enableChatCompletions: true,
      commandsRestart: true,
      enableFilePermissions: true,
      ownerAllowFrom: buildOwnerAllowFrom(storage),
      extensionsDir,
      plugins: {
        allow: [
          "easyclaw-tools",
          "easyclaw-file-permissions",
          "search-browser-fallback",
          "google-gemini-cli-auth",
          "mobile-chat-channel",
          "easyclaw-event-bridge",
          "memory-core",
          "browser-profiles-tools",
        ],
        entries: {
          "browser-profiles-tools": {
            config: {
              enabled: true,
              capabilityContext: {
                browserProfiles: {
                  enabled: browserProfilesEnabled,
                  disclosureLevel: "standard",
                  allowDynamicDiscovery: true,
                },
              },
            },
          },
          "easyclaw-tools": {
            config: {
              browserMode: curBrowserMode,
            },
          },
        },
      },
      enableGeminiCliAuth: isGeminiOAuthActive(),
      skipBootstrap: false,
      filePermissionsPluginPath,
      defaultModel: resolveGeminiOAuthModel(curModel.provider, curModel.modelId),
      stt: {
        enabled: curSttEnabled,
        provider: curSttProvider,
        nodeBin: process.execPath,
        sttCliPath,
      },
      webSearch: {
        enabled: curWebSearchEnabled,
        provider: curWebSearchProvider,
        apiKeyEnvVar: wsKeyExists ? WS_ENV_MAP[curWebSearchProvider] : undefined,
      },
      embedding: {
        enabled: curEmbeddingEnabled,
        provider: curEmbeddingProvider,
        apiKeyEnvVar: embKeyExists ? EMB_ENV_MAP[curEmbeddingProvider] : undefined,
      },
      extraProviders: { ...buildExtraProviderConfigs(), ...buildCustomProviderOverrides() },
      localProviderOverrides: buildLocalProviderOverrides(),
      browserMode: curBrowserMode,
      browserCdpPort: curBrowserCdpPort,
      agentWorkspace: join(stateDir, "workspace"),
      extraSkillDirs: [join(stateDir, "skills")],
    };
  }

  return { isGeminiOAuthActive, resolveGeminiOAuthModel, buildLocalProviderOverrides, buildFullGatewayConfig };
}
