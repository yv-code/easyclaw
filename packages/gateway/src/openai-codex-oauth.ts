import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createLogger } from "@easyclaw/logger";
import type { ProviderKeyEntry } from "@easyclaw/core";
import type { OAuthFlowCallbacks, OAuthFlowResult } from "./oauth-flow.js";
import { resolveVendorDir } from "./vendor.js";

const log = createLogger("gateway:openai-codex-oauth");

export interface OpenAICodexOAuthCredentials {
  access: string;
  refresh: string;
  expires: number;
  accountId: string;
}

export interface AcquiredCodexOAuthCredentials {
  credentials: OpenAICodexOAuthCredentials;
  email?: string;
  tokenPreview: string;
}

/**
 * Mask a token for display: show first 10 chars + "••••••••".
 */
function maskToken(token: string): string {
  if (token.length <= 10) return "••••••••••••";
  return token.slice(0, 10) + "••••••••";
}

/** loginOpenAICodex function signature from pi-ai. */
type LoginFn = (options: {
  onAuth: (info: { url: string; instructions: string }) => void;
  onProgress?: (msg: string) => void;
}) => Promise<OpenAICodexOAuthCredentials>;

/**
 * Resolve and load loginOpenAICodex from the extracted vendor helper.
 * Falls back to the upstream pi-ai subpath in dev if the extracted file
 * has not been generated yet.
 */
async function loadLoginOpenAICodex(vendorDir?: string): Promise<LoginFn> {
  const vendor = resolveVendorDir(vendorDir);
  const extractedHelperPath = join(vendor, "dist", "vendor-codex-oauth.js");
  const fallbackHelperPath = join(
    vendor,
    "node_modules",
    "@mariozechner",
    "pi-ai",
    "dist",
    "utils",
    "oauth",
    "openai-codex.js",
  );
  const helperPath = existsSync(extractedHelperPath) ? extractedHelperPath : fallbackHelperPath;

  try {
    const mod = (await import(pathToFileURL(helperPath).href)) as { loginOpenAICodex?: LoginFn };
    if (typeof mod.loginOpenAICodex !== "function") {
      throw new Error("loginOpenAICodex not exported from helper");
    }
    return mod.loginOpenAICodex;
  } catch (err) {
    throw new Error(
      `OpenAI Codex OAuth helper is unavailable in vendor/openclaw. ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Step 1: Acquire OAuth tokens from OpenAI Codex (opens browser).
 * Does NOT create provider key or store in keychain.
 * Returns raw credentials for the caller to hold temporarily.
 */
export async function acquireCodexOAuthToken(
  callbacks: OAuthFlowCallbacks,
  vendorDir?: string,
): Promise<AcquiredCodexOAuthCredentials> {
  log.info("Starting OpenAI Codex OAuth flow (acquire only)");

  const loginOpenAICodex = await loadLoginOpenAICodex(vendorDir);

  const creds = await loginOpenAICodex({
    onAuth: (info) => {
      log.info("OpenAI Codex OAuth: opening browser for auth");
      callbacks.openUrl(info.url);
      callbacks.onStatusUpdate?.(info.instructions || "Complete sign-in in browser…");
    },
    onProgress: (msg) => {
      log.info(`OAuth: ${msg}`);
      callbacks.onStatusUpdate?.(msg);
    },
  });

  log.info(`OpenAI Codex OAuth acquire complete, accountId=${creds.accountId}`);

  return {
    credentials: creds,
    email: undefined, // Codex OAuth doesn't return email
    tokenPreview: maskToken(creds.access ?? ""),
  };
}

/**
 * Step 2: Validate an OpenAI Codex access token.
 * Makes a lightweight request to OpenAI to verify the token is valid.
 */
export async function validateCodexAccessToken(
  accessToken: string,
  proxyUrl?: string,
): Promise<{ valid: boolean; error?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  let dispatcher: any;
  if (proxyUrl) {
    const { ProxyAgent } = await import("undici");
    dispatcher = new ProxyAgent(proxyUrl);
    log.info(`Validating Codex OAuth token through proxy: ${proxyUrl}`);
  }

  try {
    // Use the OpenAI models endpoint as a lightweight validation check
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
      ...(dispatcher && { dispatcher }),
    });

    log.info(`Codex OAuth token validation response: ${res.status} ${res.statusText}`);

    if (res.status === 401 || res.status === 403) {
      return { valid: false, error: "Invalid or expired OAuth token" };
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { valid: false, error: `OpenAI API returned ${res.status}: ${body.slice(0, 200)}` };
    }
    return { valid: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("Codex OAuth validation failed:", msg);
    if (msg.includes("abort")) {
      return { valid: false, error: "Validation timed out — check your network connection" };
    }
    return { valid: false, error: `Network error: ${msg}` };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Step 3: Store OAuth credentials in keychain and create provider_keys row.
 * Call after validation succeeds.
 */
export async function saveCodexOAuthCredentials(
  credentials: OpenAICodexOAuthCredentials,
  storage: {
    providerKeys: {
      create(entry: ProviderKeyEntry): ProviderKeyEntry;
      getByProvider(provider: string): ProviderKeyEntry[];
      setDefault(id: string): void;
    };
  },
  secretStore: {
    set(key: string, value: string): Promise<void>;
  },
  options?: {
    proxyBaseUrl?: string | null;
    proxyCredentials?: string | null;
    label?: string;
    model?: string;
  },
): Promise<OAuthFlowResult> {
  const provider = "openai-codex";
  const model = options?.model || "gpt-5.2-codex";
  const id = randomUUID();

  // Store credential JSON in Keychain
  await secretStore.set(`oauth-cred-${id}`, JSON.stringify(credentials));

  // Store proxy credentials if provided
  if (options?.proxyCredentials) {
    await secretStore.set(`proxy-auth-${id}`, options.proxyCredentials);
  }

  // Create provider_keys row
  const label = options?.label || "OpenAI Codex OAuth";
  const entry = storage.providerKeys.create({
    id,
    provider,
    label,
    model,
    isDefault: false,
    authType: "oauth",
    proxyBaseUrl: options?.proxyBaseUrl ?? null,
    createdAt: "",
    updatedAt: "",
  });

  // Set as default for this provider
  storage.providerKeys.setDefault(entry.id);

  log.info(`Created OAuth provider key ${id} for ${provider}`);

  return {
    providerKeyId: id,
    email: undefined,
    provider,
  };
}
