import { describe, it, expect, beforeEach } from "vitest";
import plugin from "./index.js";
import { setRunToolContext, getRunToolContext, clearRunToolContexts } from "./tool-selection.js";

describe("browser-profiles-tools plugin", () => {
  it("exports a valid plugin definition", () => {
    expect(plugin.id).toBe("browser-profiles-tools");
    expect(plugin.name).toBe("Browser Profiles Tools");
    expect(typeof plugin.activate).toBe("function");
  });

  it("registers before_prompt_build, before_tool_call hooks and tools on activate", () => {
    const hooks: string[] = [];
    const tools: unknown[] = [];

    const mockApi = {
      logger: { info: () => {} },
      pluginConfig: {
        capabilityContext: {
          browserProfiles: {
            enabled: true,
            disclosureLevel: "full",
            allowDynamicDiscovery: false,
          },
        },
      },
      on(event: string) {
        hooks.push(event);
      },
      registerTool(factory: unknown) {
        tools.push(factory);
      },
      registerGatewayMethod() {},
    };

    plugin.activate(mockApi);

    expect(hooks).toContain("before_tool_call");
    expect(hooks).toContain("before_prompt_build");
    // 3 read tools + 2 write tools = 5
    expect(tools).toHaveLength(5);
  });

  it("registers browser_profiles_set_run_context gateway method", () => {
    const gatewayMethods: string[] = [];

    const mockApi = {
      logger: { info: () => {} },
      on() {},
      registerTool() {},
      registerGatewayMethod(name: string) {
        gatewayMethods.push(name);
      },
    };

    plugin.activate(mockApi);
    expect(gatewayMethods).toContain("browser_profiles_set_run_context");
  });

  it("tool factories return null when disclosure level is 'off' (default-closed)", () => {
    const tools: Array<(ctx: { config?: Record<string, unknown> }) => unknown> = [];

    const mockApi = {
      logger: { info: () => {} },
      on() {},
      registerTool(factory: (ctx: { config?: Record<string, unknown> }) => unknown) {
        tools.push(factory);
      },
      registerGatewayMethod() {},
    };

    plugin.activate(mockApi);

    const config = {
      capabilityContext: {
        browserProfiles: {
          enabled: false,
          disclosureLevel: "off" as const,
          allowDynamicDiscovery: false,
        },
      },
    };

    for (const factory of tools) {
      const result = factory({ config });
      expect(result).toBeNull();
    }
  });

  it("tool factories return null when NO config is provided (default-closed)", () => {
    const tools: Array<(ctx: { config?: Record<string, unknown> }) => unknown> = [];

    const mockApi = {
      logger: { info: () => {} },
      on() {},
      registerTool(factory: (ctx: { config?: Record<string, unknown> }) => unknown) {
        tools.push(factory);
      },
      registerGatewayMethod() {},
    };

    plugin.activate(mockApi);

    // No config at all — should default to disabled/off
    for (const factory of tools) {
      const result = factory({});
      expect(result).toBeNull();
    }
  });

  it("tool factories return tool defs when disclosure level is 'full'", () => {
    const tools: Array<(ctx: { config?: Record<string, unknown> }) => unknown> = [];

    const mockApi = {
      logger: { info: () => {} },
      on() {},
      registerTool(factory: (ctx: { config?: Record<string, unknown> }) => unknown) {
        tools.push(factory);
      },
      registerGatewayMethod() {},
    };

    plugin.activate(mockApi);

    const config = {
      capabilityContext: {
        browserProfiles: {
          enabled: true,
          disclosureLevel: "full" as const,
          allowDynamicDiscovery: false,
        },
      },
    };

    const results = tools.map((factory) => factory({ config }));
    for (const result of results) {
      expect(result).not.toBeNull();
      const tool = result as { name: string; description: string; parameters: unknown };
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.parameters).toBeTruthy();
    }
  });

  it("standard disclosure registers only read tools (3), no write tools", () => {
    const tools: Array<(ctx: { config?: Record<string, unknown> }) => unknown> = [];

    const mockApi = {
      logger: { info: () => {} },
      pluginConfig: {
        capabilityContext: {
          browserProfiles: {
            enabled: true,
            disclosureLevel: "standard",
            allowDynamicDiscovery: false,
          },
        },
      },
      on() {},
      registerTool(factory: (ctx: { config?: Record<string, unknown> }) => unknown) {
        tools.push(factory);
      },
      registerGatewayMethod() {},
    };

    plugin.activate(mockApi);

    // Standard disclosure: only read tools are registered (3 total), no write tools
    expect(tools).toHaveLength(3);
    const results = tools.map((factory) => factory({}));
    for (const result of results) {
      expect(result).not.toBeNull();
      const tool = result as { name: string };
      expect(tool.name).toBeTruthy();
    }
  });

  it("all tools have proper name, description, and parameters schema", () => {
    const tools: Array<(ctx: { config?: Record<string, unknown> }) => unknown> = [];

    const mockApi = {
      logger: { info: () => {} },
      on() {},
      registerTool(factory: (ctx: { config?: Record<string, unknown> }) => unknown) {
        tools.push(factory);
      },
      registerGatewayMethod() {},
    };

    plugin.activate(mockApi);

    const config = {
      capabilityContext: {
        browserProfiles: {
          enabled: true,
          disclosureLevel: "full" as const,
          allowDynamicDiscovery: false,
        },
      },
    };

    const expectedNames = [
      "browser_profiles-list",
      "browser_profiles-get",
      "browser_profiles-find",
      "browser_profiles-manage",
      "browser_profiles-test_proxy",
    ];

    const results = tools.map((factory) => factory({ config })) as Array<{
      name: string;
      label: string;
      description: string;
      parameters: { type: string; properties: Record<string, unknown> };
    }>;

    for (let i = 0; i < results.length; i++) {
      const tool = results[i];
      expect(tool.name).toBe(expectedNames[i]);
      expect(tool.label).toBeTruthy();
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.parameters).toBeDefined();
      expect(tool.parameters.type).toBe("object");
    }
  });

  it("before_tool_call blocks when no sessionKey is present", async () => {
    let toolHook: ((event: { toolName: string; params: Record<string, unknown> }, ctx: { sessionKey?: string }) => unknown) | undefined;

    const mockApi = {
      logger: { info: () => {} },
      on(event: string, handler: (...args: any[]) => any) {
        if (event === "before_tool_call") {
          toolHook = handler;
        }
      },
      registerTool() {},
      registerGatewayMethod() {},
    };

    plugin.activate(mockApi);
    expect(toolHook).toBeDefined();

    const result = await toolHook!(
      { toolName: "browser_profiles-list", params: {} },
      {},
    );
    expect(result).toEqual({
      block: true,
      blockReason: "No session context available for tool access check",
    });
  });

  it("before_tool_call ignores non-browser-profiles tools", async () => {
    let toolHook: ((event: { toolName: string; params: Record<string, unknown> }, ctx: { sessionKey?: string }) => unknown) | undefined;

    const mockApi = {
      logger: { info: () => {} },
      on(event: string, handler: (...args: any[]) => any) {
        if (event === "before_tool_call") {
          toolHook = handler;
        }
      },
      registerTool() {},
      registerGatewayMethod() {},
    };

    plugin.activate(mockApi);

    const result = await toolHook!(
      { toolName: "some_other_tool", params: {} },
      { sessionKey: "s1" },
    );
    expect(result).toEqual({});
  });

  it("before_tool_call blocks when run context is not pushed", async () => {
    let toolHook: ((event: { toolName: string; params: Record<string, unknown> }, ctx: { sessionKey?: string }) => unknown) | undefined;

    const mockApi = {
      logger: { info: () => {} },
      on(event: string, handler: (...args: any[]) => any) {
        if (event === "before_tool_call") {
          toolHook = handler;
        }
      },
      registerTool() {},
      registerGatewayMethod() {},
    };

    plugin.activate(mockApi);

    // sessionKey is present but no context was pushed
    const result = await toolHook!(
      { toolName: "browser_profiles-list", params: {} },
      { sessionKey: "session-with-no-context" },
    );
    expect(result).toEqual({
      block: true,
      blockReason: "No run tool context available — tools not configured for this session",
    });
  });

  describe("session_end hook", () => {
    beforeEach(() => {
      clearRunToolContexts();
    });

    function activateAndCaptureHooks() {
      const hooks: Record<string, (...args: any[]) => any> = {};
      let gatewayHandler: ((args: { params: Record<string, unknown>; respond: (ok: boolean, payload?: unknown, error?: { code: string; message: string }) => void }) => void) | undefined;

      const mockApi = {
        logger: { info: () => {} },
        on(event: string, handler: (...args: any[]) => any) {
          hooks[event] = handler;
        },
        registerTool() {},
        registerGatewayMethod(name: string, handler: any) {
          if (name === "browser_profiles_set_run_context") {
            gatewayHandler = handler;
          }
        },
      };

      plugin.activate(mockApi);
      return { hooks, gatewayHandler };
    }

    function pushContext(
      gatewayHandler: ((args: { params: Record<string, unknown>; respond: (...args: any[]) => void }) => void),
      scopeKey: string,
      selectedTools: string[],
    ) {
      gatewayHandler({
        params: {
          scopeType: "chat_session",
          scopeKey,
          entitledTools: selectedTools,
          selectedTools,
        },
        respond: () => {},
      });
    }

    it("session_end hook is registered", () => {
      const { hooks } = activateAndCaptureHooks();
      expect(hooks["session_end"]).toBeDefined();
    });

    it("session_end cleans up context for the session", async () => {
      const { hooks, gatewayHandler } = activateAndCaptureHooks();
      pushContext(gatewayHandler!, "sess-1", ["browser_profiles-list"]);
      expect(getRunToolContext("sess-1")).toBeDefined();

      await hooks["session_end"](
        { sessionId: "id-1", sessionKey: "sess-1" },
        {},
      );
      expect(getRunToolContext("sess-1")).toBeUndefined();
    });

    it("tool call after session_end cleanup is blocked (fail-closed)", async () => {
      const { hooks, gatewayHandler } = activateAndCaptureHooks();
      pushContext(gatewayHandler!, "sess-2", ["browser_profiles-list"]);

      await hooks["session_end"](
        { sessionId: "id-2", sessionKey: "sess-2" },
        {},
      );

      const result = await hooks["before_tool_call"](
        { toolName: "browser_profiles-list", params: {} },
        { sessionKey: "sess-2" },
      );
      expect(result).toEqual({
        block: true,
        blockReason: "No run tool context available — tools not configured for this session",
      });
    });

    it("session_end does not affect other sessions (cross-session isolation)", async () => {
      const { hooks, gatewayHandler } = activateAndCaptureHooks();
      pushContext(gatewayHandler!, "sess-a", ["browser_profiles-list"]);
      pushContext(gatewayHandler!, "sess-b", ["browser_profiles-get"]);

      await hooks["session_end"](
        { sessionId: "id-a", sessionKey: "sess-a" },
        {},
      );

      expect(getRunToolContext("sess-a")).toBeUndefined();
      expect(getRunToolContext("sess-b")).toBeDefined();
      expect(getRunToolContext("sess-b")!.selectedTools).toEqual(["browser_profiles-get"]);
    });
  });

  it("new context overwrites old context", async () => {
    clearRunToolContexts();

    const hooks: Record<string, (...args: any[]) => any> = {};
    let gatewayHandler: ((args: { params: Record<string, unknown>; respond: (...args: any[]) => void }) => void) | undefined;

    const mockApi = {
      logger: { info: () => {} },
      on(event: string, handler: (...args: any[]) => any) {
        hooks[event] = handler;
      },
      registerTool() {},
      registerGatewayMethod(name: string, handler: any) {
        if (name === "browser_profiles_set_run_context") {
          gatewayHandler = handler;
        }
      },
    };

    plugin.activate(mockApi);

    // Push context with tool A enabled
    gatewayHandler!({
      params: {
        scopeType: "chat_session",
        scopeKey: "sess-overwrite",
        entitledTools: ["browser_profiles-list"],
        selectedTools: ["browser_profiles-list"],
      },
      respond: () => {},
    });

    // Overwrite with tool B enabled
    gatewayHandler!({
      params: {
        scopeType: "chat_session",
        scopeKey: "sess-overwrite",
        entitledTools: ["browser_profiles-get"],
        selectedTools: ["browser_profiles-get"],
      },
      respond: () => {},
    });

    // Tool A should be blocked (not entitled in new context)
    const resultA = await hooks["before_tool_call"](
      { toolName: "browser_profiles-list", params: {} },
      { sessionKey: "sess-overwrite" },
    );
    expect(resultA).toEqual({
      block: true,
      blockReason: "Tool not available for this account",
    });

    // Tool B should be allowed
    const resultB = await hooks["before_tool_call"](
      { toolName: "browser_profiles-get", params: {} },
      { sessionKey: "sess-overwrite" },
    );
    expect(resultB).toEqual({});
  });
});
