import { resolveAgyExecutable } from "../platform.ts";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { homedir } from "node:os";
import { Readable, Writable } from "node:stream";
import {
  client,
  ndJsonStream,
  PROTOCOL_VERSION,
} from "@agentclientprotocol/sdk";
import type {
  ClientApp,
  ClientConnection,
  ContentBlock,
  InitializeResponse,
  NewSessionResponse,
  SessionNotification,
} from "@agentclientprotocol/sdk";

export interface AcpClientHandlerRegistrar {
  register(app: ClientApp): void;
  registerSession?(sessionId: string, cwd: string, toolsEnabled?: boolean): void;
  unregisterSession?(sessionId: string): void;
  dispose?(): void;
}

export interface AntigravityModelVariant {
  modelId: string;
  name: string;
  supportedInputTypes?: string[];
}

export interface AntigravityConfigOption {
  id: string;
  name?: string;
  currentValue?: string;
  options?: Array<{ value: string; name?: string }>;
}

export interface AntigravityModelFamily {
  id: string;
  name: string;
  thoughtLevels: string[];
  defaultThoughtLevel?: string;
  supportsThinking: boolean;
  supportedInputTypes: string[];
}

export interface AntigravityNewSessionResponse extends NewSessionResponse {
  models?: { availableModels?: AntigravityModelVariant[] };
}

export interface AntigravityCatalogue {
  availableModels: AntigravityModelVariant[];
  modelFamilies: AntigravityModelFamily[];
  modeOptions: string[];
  defaultMode?: string;
}

export class AntigravityAcpProcess {
  private child?: ChildProcessWithoutNullStreams;
  private connection?: ClientConnection;
  private initialized?: InitializeResponse;
  private readonly updateListeners = new Set<(value: SessionNotification) => void>();
  private readonly clientHandlers?: AcpClientHandlerRegistrar;
  private stderrTail = "";

  constructor(clientHandlers?: AcpClientHandlerRegistrar) {
    this.clientHandlers = clientHandlers;
  }

  async start(): Promise<InitializeResponse> {
    if (this.connection && this.initialized) return this.initialized;

    const executable = this.resolveExecutable();
    const child = spawn(executable, ["acp", "--disable-telemetry"], {
      cwd: homedir(),
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
      windowsHide: true,
    });
    this.child = child;
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-8000);
    });

    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });

    const app = client({ name: "Antigravity for Cursor" });
    this.clientHandlers?.register(app);
    app.onNotification("session/update", ({ params }) => {
      for (const listener of this.updateListeners) listener(params);
    });

    const stream = ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    );
    const connection = app.connect(stream);
    this.connection = connection;

    try {
      this.initialized = await connection.agent.request("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: { name: "antigravity-cursor", version: "1.1.0" },
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          terminal: true,
        },
      });
      child.once("exit", () => {
        connection.close();
        if (this.connection === connection) {
          this.connection = undefined;
          this.initialized = undefined;
          this.child = undefined;
        }
      });
      return this.initialized;
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  onSessionUpdate(listener: (value: SessionNotification) => void): () => void {
    this.updateListeners.add(listener);
    return () => this.updateListeners.delete(listener);
  }

  getStderrTail(): string {
    return this.stderrTail;
  }

  async getCatalogue(cwd: string): Promise<AntigravityCatalogue> {
    const session = await this.createSession(cwd, false);
    try {
      const availableModels = session.models?.availableModels ?? [];
      const initialOptions = (session.configOptions ?? []) as unknown as AntigravityConfigOption[];
      const modelOption = initialOptions.find((option) => option.id === "model");
      const modelChoices = modelOption?.options ?? [];
      const modelFamilies: AntigravityModelFamily[] = [];

      for (const choice of modelChoices) {
        const familyId = choice.value;
        const updated = await this.setConfigOption(session.sessionId, "model", familyId) as {
          configOptions?: AntigravityConfigOption[];
        };
        const thought = updated.configOptions?.find((option) => option.id === "thought_level");
        const variants = availableModels.filter((item) =>
          item.modelId === familyId || item.modelId.startsWith(familyId + "-"),
        );
        modelFamilies.push({
          id: familyId,
          name: choice.name || familyId,
          thoughtLevels: (thought?.options ?? []).map((option) => option.value),
          defaultThoughtLevel: thought?.currentValue,
          supportsThinking: Boolean(thought) || variants.some((item) =>
            /thinking/i.test(item.name) || /thinking$/i.test(item.modelId),
          ),
          supportedInputTypes: [...new Set(variants.flatMap((item) => item.supportedInputTypes ?? []))],
        });
      }

      const mode = initialOptions.find((option) => option.id === "mode");
      return {
        availableModels,
        modelFamilies,
        modeOptions: (mode?.options ?? []).map((option) => option.value),
        defaultMode: mode?.currentValue,
      };
    } finally {
      await this.closeSession(session.sessionId).catch(() => undefined);
    }
  }

  async createSession(cwd: string, toolsEnabled = true): Promise<AntigravityNewSessionResponse> {
    const response = await this.requireConnection().agent.request("session/new", {
      cwd,
      mcpServers: [],
    }) as AntigravityNewSessionResponse;
    this.clientHandlers?.registerSession?.(response.sessionId, cwd, toolsEnabled);
    return response;
  }

  async loadSession(sessionId: string, cwd: string, toolsEnabled = true) {
    const response = await this.requireConnection().agent.request("session/load", {
      sessionId,
      cwd,
      mcpServers: [],
    });
    this.clientHandlers?.registerSession?.(sessionId, cwd, toolsEnabled);
    return response;
  }

  setConfigOption(sessionId: string, configId: string, value: string) {
    return this.requireConnection().agent.request("session/set_config_option", {
      sessionId,
      configId,
      value,
    });
  }

  prompt(sessionId: string, prompt: string | ContentBlock[]) {
    const blocks: ContentBlock[] = typeof prompt === "string"
      ? [{ type: "text", text: prompt }]
      : prompt;
    return this.requireConnection().agent.request("session/prompt", {
      sessionId,
      prompt: blocks,
    });
  }

  cancel(sessionId: string): Promise<void> {
    return this.requireConnection().agent.notify("session/cancel", { sessionId });
  }

  async closeSession(sessionId: string) {
    try {
      return await this.requireConnection().agent.request("session/close", { sessionId });
    } finally {
      this.clientHandlers?.unregisterSession?.(sessionId);
    }
  }

  dispose(): void {
    this.connection?.close();
    this.connection = undefined;
    this.initialized = undefined;
    this.child?.kill("SIGTERM");
    this.child = undefined;
    this.clientHandlers?.dispose?.();
  }

  private requireConnection(): ClientConnection {
    if (!this.connection) throw new Error("Antigravity ACP is not connected.");
    return this.connection;
  }

  private resolveExecutable(): string {
    return resolveAgyExecutable();
  }
}
