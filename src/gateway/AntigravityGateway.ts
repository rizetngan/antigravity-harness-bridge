import * as vscode from "vscode";
import { sessionWorkspace } from "./workspacePolicy.js";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { isCursorResources, platformPaths, pathIdentity, samePath } from "../platform.ts";
import path from "node:path";
import { AntigravityAcpProcess, type AntigravityCatalogue } from "../acp/AntigravityAcpProcess.js";
import { AcpClientHandlers } from "../acp/AcpClientHandlers.js";
import { buildCursorModelDefinitions, resolveAcpModelSelection } from "../catalog/modelCatalog.js";
import { CursorConversationReader, type CursorConversationSnapshot } from "../context/CursorConversationReader.js";
import { buildContextSnapshot } from "../context/ContextSnapshot.js";
import { parseNativeHistory, nativeSnapshot, nativeHistoryFingerprint } from "../context/NativeHistory.js";
import { SessionStore, type CursorAcpSessionRecord } from "../session/SessionStore.js";
import { gatewayLocation, readGatewayPort, persistGatewayPort } from "./location.js";
import { lock } from "proper-lockfile";
import { CursorCompatibility } from "../cursor/compat.js";
import {
  adaptSessionUpdate,
  buildCheckpointData,
  buildPromptText,
  getConversationId,
  getCustomSystemPrompt,
  getRunRequest,
  getSelectedModelId,
  getThinkingEffort,
  getUserMessage,
  getUserText,
  getRequestedMode,
  withoutCurrentUserMessage,
} from "./runAdapter.js";

const HOST = "127.0.0.1";
const MAX_BODY_BYTES = 20 * 1024 * 1024;
const IDLE_INPUT_WINDOW_MS = 250;

interface ActiveRun {
  sessionId: string;
  cancelled: boolean;
  pendingInputs: Array<{ userMessage: Record<string, any>; text: string }>;
}

interface GatewayConfig {
  url: string;
  token: string;
}

class AsyncQueue<T> implements AsyncIterable<T> {
  private values: T[] = [];
  private waiters: Array<{
    resolve: (value: IteratorResult<T>) => void;
    reject: (error: unknown) => void;
  }> = [];
  private ended = false;
  private failure?: unknown;

  push(value: T): void {
    if (this.ended) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve({ value, done: false });
    else this.values.push(value);
  }

  close(): void {
    if (this.ended) return;
    this.ended = true;
    for (const waiter of this.waiters.splice(0)) waiter.resolve({ value: undefined as T, done: true });
  }

  fail(error: unknown): void {
    if (this.ended) return;
    this.ended = true;
    this.failure = error;
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }

  async next(): Promise<IteratorResult<T>> {
    if (this.values.length) return { value: this.values.shift() as T, done: false };
    if (this.failure) throw this.failure;
    if (this.ended) return { value: undefined as T, done: true };
    return new Promise<IteratorResult<T>>((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return { next: () => this.next() };
  }
}

export class AntigravityGateway {
  private acp = new AntigravityAcpProcess(new AcpClientHandlers());
  private readonly reader: CursorConversationReader;
  private readonly output: vscode.OutputChannel;
  private readonly storageDirectory: string;
  private port: number;
  private readonly appRoot?: string;
  private readonly sessions: SessionStore;
  private readonly profileId: string;
  private borrowedGateway = false;
  private paused = true;
  private borrowedConnected = false;
  private borrowedVariants = 0;
  private borrowedActive = 0;
  private borrowedConnecting = false;
  private borrowedError?: string;
  private readonly onRemoteStop?: () => Promise<void>;
  private stopping = false;
  private preparingRuns = 0;
  private readonly activeRuns = new Map<string, ActiveRun>();
  private server?: Server;
  private token = "";
  private catalogue?: AntigravityCatalogue;
  private models: ReturnType<typeof buildCursorModelDefinitions> = [];
  private catalogueRefreshPromise?: Promise<ReturnType<typeof buildCursorModelDefinitions>>;
  private catalogueRetryAt = 0;
  private catalogueError?: string;
  private lastCatalogErrorLoggedAt = 0;
  private revision = 1;
  private catalogRequestCount = 0;
  private runRequestCount = 0;
  private disposed = false;

  constructor(output: vscode.OutputChannel, profileStorage?: string, appRoot?: string, onRemoteStop?: () => Promise<void>) {
    this.onRemoteStop = onRemoteStop;
    this.appRoot = appRoot;
    this.output = output;
    const location = gatewayLocation(platformPaths().support, appRoot);
    this.storageDirectory = location.directory;
    this.port = location.port;
    this.reader = new CursorConversationReader(profileStorage ? path.join(path.dirname(profileStorage), "state.vscdb") : path.join(location.directory, "state.vscdb"));
    this.profileId = profileStorage ? createHash("sha256").update(pathIdentity(profileStorage)).digest("hex").slice(0, 20) : "probe";
    this.sessions = new SessionStore(profileStorage ? path.join(profileStorage, "acp-sessions") : this.storageDirectory);
  }

  get running(): boolean { return !this.paused && Boolean(this.server || this.borrowedGateway); }

  async isPaused(): Promise<boolean> {
    try { await fs.access(path.join(this.storageDirectory, "service-paused")); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  }

  private async setPaused(paused: boolean): Promise<void> {
    await fs.mkdir(this.storageDirectory, { recursive: true });
    const marker = path.join(this.storageDirectory, "service-paused");
    if (paused) await fs.writeFile(marker, String(Date.now()), { mode: 0o600 });
    else await fs.rm(marker, { force: true });
  }

  async attachExisting(): Promise<boolean> {
    await fs.mkdir(this.storageDirectory, { recursive: true });
    this.port = readGatewayPort(this.storageDirectory, this.port);
    this.token = await this.loadOrCreateToken();
    if (!(await this.existingGatewayIsHealthy())) { this.token = ""; return false; }
    this.borrowedGateway = true;
    this.output.appendLine("Attached to the shared Antigravity gateway already running in another Cursor window.");
    await this.syncRemoteStatus();
    return this.borrowedGateway;
  }

  get panelStatus() {
    return {
      running: this.running,
      connecting: this.borrowedGateway ? this.borrowedConnecting : Boolean(this.catalogueRefreshPromise),
      connected: this.borrowedGateway ? this.borrowedConnected : Boolean(this.catalogue),
      error: (this.borrowedGateway ? this.borrowedError : this.catalogueError) ? (/authentication required|please sign in|not signed in/i.test((this.borrowedGateway ? this.borrowedError : this.catalogueError) ?? "") ? "login" : "connection") : undefined,
      models: this.models.map(model => ({ name: model.name, efforts: model.reasoning?.effortValues ?? [] })),
      variants: this.borrowedGateway ? this.borrowedVariants : this.catalogue?.availableModels.length ?? 0,
      active: this.activeRuns.size + this.preparingRuns + (this.borrowedGateway ? this.borrowedActive : 0),
      borrowed: this.borrowedGateway,
    };
  }

  async stop(): Promise<void> {
    if (this.borrowedGateway) {
      const result = await this.remoteControl("stop");
      if (!result.accepted) throw new Error(result.error ?? "Unable to stop shared service.");
      await this.syncRemoteStatus();
      if (this.running) throw new Error("Shared service has not stopped.");
      return;
    }
    if (this.activeRuns.size || this.preparingRuns) throw new Error("Finish or cancel the current Antigravity task first.");
    this.stopping = true;
    try {
      await this.setPaused(true);
      this.paused = true;
      if (this.catalogueRefreshPromise) await this.catalogueRefreshPromise.catch(() => undefined);
      this.acp.dispose();
      this.acp = new AntigravityAcpProcess(new AcpClientHandlers());
      this.catalogue = undefined;
      this.models = [];
      this.catalogueError = undefined;
      this.catalogueRetryAt = 0;
      await this.sessions.dispose();
      // Keep the authenticated local control listener alive so every renderer
      // can distinguish an explicit stop from a transient disconnection.
      this.revision += 1;
      this.output.appendLine("Antigravity ACP stopped; Cursor model mode restored.");
    } finally { this.stopping = false; }
  }

  async start(paused = false, allowAlternatePort = false): Promise<GatewayConfig> {
    if (this.disposed || this.stopping) throw new Error("Antigravity service is stopping or disposed.");
    if (this.borrowedGateway) {
      if (await this.existingGatewayIsHealthy()) {
        if (!paused) await this.remoteControl("start");
        await this.syncRemoteStatus();
        return this.config();
      }
      this.borrowedGateway = false;
      this.borrowedConnected = false;
      this.borrowedVariants = 0;
      this.borrowedActive = 0;
      this.borrowedConnecting = false;
      this.borrowedError = undefined;
      this.models = [];
      this.token = "";
    }
    if (this.server && this.token) {
      await this.setPaused(paused);
      this.paused = paused;
      this.revision += 1;
      return this.config();
    }
    await fs.mkdir(this.storageDirectory, { recursive: true });
    // Serialize initial token/endpoint selection across windows. Normal start/stop
    // of the same listener never needs this lock.
    const release = await lock(this.storageDirectory, {
      lockfilePath: path.join(this.storageDirectory, "gateway-start.lock"),
      stale: 600_000, update: 30_000,
      retries: { retries: 6, minTimeout: 100, maxTimeout: 500 },
    });
    try {
      if (this.server && this.token) {
        await this.setPaused(paused);
        this.paused = paused;
        this.revision += 1;
        return this.config();
      }
      this.port = readGatewayPort(this.storageDirectory, this.port);
      this.token = await this.loadOrCreateToken();
      const server = createServer((request, response) => {
        void this.handleRequest(request, response);
      });
      const listen = (port: number) => new Promise<void>((resolve, reject) => {
        const onError = (error: NodeJS.ErrnoException) => {
          server.off("listening", onListening); reject(error);
        };
        const onListening = () => {
          server.off("error", onError); resolve();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, HOST);
      });
      try {
        try { await listen(this.port); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
          const health = await this.readExistingGatewayHealth();
          if (health?.profileId === this.profileId && health.ok === true) {
            this.borrowedGateway = true;
            if (!paused) await this.remoteControl("start");
            await this.syncRemoteStatus();
            this.output.appendLine("Reusing the authenticated ACP gateway started by another window of this profile.");
            return this.config();
          }
          // A working bridge belonging to another profile remains isolated.
          // An installed Workbench embeds its endpoint; never relocate it silently.
          if (health?.ok === true || !allowAlternatePort || !this.appRoot ||
              await new CursorCompatibility(this.appRoot, this.storageDirectory, "").hasInstalledMarkers()) throw error;
          await listen(0);
          const address = server.address();
          if (!address || typeof address === "string") throw new Error("Unable to obtain the local gateway port.");
          // Do not reuse the token sent to an unrelated occupant during the health probe.
          this.token = randomBytes(32).toString("base64url");
          await fs.writeFile(path.join(this.storageDirectory, "bridge-token"), this.token, { mode: 0o600 });
          await persistGatewayPort(this.storageDirectory, address.port);
          this.port = address.port;
          this.output.appendLine("Preferred local port occupied; assigned an available port for the new integration.");
        }
        await this.setPaused(paused);
        this.paused = paused;
        this.server = server;
        this.output.appendLine("Local ACP gateway listening at http://" + HOST + ":" + this.port);
      } catch (error) {
        server.close();
        throw error;
      }
      return this.config();
    } finally { await release(); }
  }

  async refreshCatalogue(force = false): Promise<ReturnType<typeof buildCursorModelDefinitions>> {
    if (this.stopping || this.disposed || !this.running) throw new Error("Antigravity service is stopped.");
    if (this.borrowedGateway) {
      try {
        const result = force
          ? await this.remoteControl("refresh")
          : await this.remoteGet("/catalog") as { models: ReturnType<typeof buildCursorModelDefinitions>; variants?: number };
        this.applyBorrowedState(result);
        return this.models;
      } catch (error) {
        this.borrowedConnected = false;
        this.borrowedError = safeError(error);
        throw error;
      }
    }
    if (!force && this.catalogue) return this.models;
    if (this.catalogueRefreshPromise) return this.catalogueRefreshPromise;
    if (!force && this.catalogueError && Date.now() < this.catalogueRetryAt) {
      throw new Error(this.catalogueError);
    }

    const refresh = (async () => {
      try {
        const cwd = defaultWorkspaceDirectory();
        await this.acp.start();
        const catalogue = await this.acp.getCatalogue(cwd);
        const models = buildCursorModelDefinitions(catalogue);
        this.catalogue = catalogue;
        this.models = models;
        this.catalogueError = undefined;
        this.catalogueRetryAt = 0;
        this.revision += 1;
        this.output.appendLine(
          `Antigravity catalogue refreshed · ${catalogue.availableModels.length} variants · ${models.length} model families`,
        );
        return models;
      } catch (error) {
        const message = safeError(error);
        this.catalogueError = message;
        this.catalogueRetryAt = Date.now() + (
          /authentication required|please sign in|not signed in/i.test(message) ? 30_000 : 5_000
        );
        throw error;
      }
    })();

    this.catalogueRefreshPromise = refresh;
    try {
      return await refresh;
    } finally {
      if (this.catalogueRefreshPromise === refresh) this.catalogueRefreshPromise = undefined;
    }
  }

  async reconnect(): Promise<ReturnType<typeof buildCursorModelDefinitions>> {
    if (!this.running || this.stopping) throw new Error("Antigravity service is not running.");
    if (this.borrowedGateway) {
      const result = await this.remoteControl("reconnect");
      this.applyBorrowedState(result);
      return this.models;
    }
    if (this.activeRuns.size || this.preparingRuns) {
      throw new Error("Antigravity 正在执行任务，请等待当前任务结束后再重新连接。");
    }
    if (this.catalogueRefreshPromise) {
      await this.catalogueRefreshPromise.catch(() => undefined);
    }

    this.acp.dispose();
    this.acp = new AntigravityAcpProcess(new AcpClientHandlers());
    this.catalogue = undefined;
    this.models = [];
    this.catalogueError = undefined;
    this.catalogueRetryAt = 0;
    this.lastCatalogErrorLoggedAt = 0;
    return this.refreshCatalogue(true);
  }

  getConfig(): GatewayConfig {
    if (!this.running || !this.token) throw new Error("Antigravity gateway has not started.");
    return this.config();
  }

  async syncRemoteStatus(): Promise<void> {
    if (!this.borrowedGateway || this.stopping || this.disposed) return;
    try {
      const status = await this.remoteGet("/status") as {
        running: boolean; connected: boolean; models: ReturnType<typeof buildCursorModelDefinitions>;
        variants: number; active: number; connecting: boolean; error?: string;
      };
      this.paused = !status.running;
      this.applyBorrowedState(status);
    } catch (error) {
      this.borrowedConnected = false;
      this.borrowedVariants = 0;
      this.borrowedActive = 0;
      this.borrowedConnecting = false;
      this.borrowedError = safeError(error);
      if (/ECONNREFUSED|fetch failed|service is stopped/i.test(this.borrowedError)) {
        this.borrowedGateway = false;
        this.models = [];
        this.token = "";
      }
    }
  }

  private applyBorrowedState(result: {
    models?: ReturnType<typeof buildCursorModelDefinitions>;
    variants?: number; active?: number; connecting?: boolean; connected?: boolean; error?: string;
  }): void {
    this.models = result.models ?? [];
    this.borrowedVariants = result.variants ?? this.models.reduce((total, model) => total + model.variants.length, 0);
    this.borrowedActive = result.active ?? 0;
    this.borrowedConnecting = result.connecting ?? false;
    this.borrowedConnected = result.connected ?? this.models.length > 0;
    this.borrowedError = result.error;
  }

  private async remoteGet(route: string): Promise<any> {
    const response = await fetch(this.config().url + route, {
      headers: { Authorization: "Bearer " + this.token },
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (response.status === 404) throw new Error("服务所属的另一个 Cursor 窗口仍在运行旧版管理接口，请先重载所有 Cursor 窗口。");
    if (!response.ok) throw new Error(body.error ?? "Antigravity service is unavailable.");
    return body;
  }

  private async remoteControl(action: "refresh" | "reconnect" | "stop" | "start"): Promise<any> {
    const response = await fetch(this.config().url + "/control", {
      method: "POST",
      headers: { Authorization: "Bearer " + this.token, "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
      signal: AbortSignal.timeout(60_000),
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (response.status === 404) throw new Error("服务所属的另一个 Cursor 窗口仍在运行旧版管理接口，请先重载所有 Cursor 窗口。");
    if (!response.ok) throw new Error(body.error ?? "Antigravity service control failed.");
    return body;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const run of this.activeRuns.values()) {
      run.cancelled = true;
      void this.acp.cancel(run.sessionId).catch(() => undefined);
    }
    this.activeRuns.clear();
    this.server?.close();
    this.server = undefined;
    this.acp.dispose();
    void this.sessions.dispose();
  }

  private config(): GatewayConfig {
    return { url: `http://${HOST}:${this.port}`, token: this.token };
  }

  private async readExistingGatewayHealth(): Promise<{ ok?: boolean; profileId?: string } | undefined> {
    try {
      const response = await fetch("http://" + HOST + ":" + this.port + "/health", {
        headers: { Authorization: "Bearer " + this.token },
        signal: AbortSignal.timeout(1500),
      });
      if (!response.ok) return undefined;
      return await response.json() as { ok?: boolean; profileId?: string };
    } catch { return undefined; }
  }

  private async existingGatewayIsHealthy(): Promise<boolean> {
    const health = await this.readExistingGatewayHealth();
    return health?.ok === true && health.profileId === this.profileId;
  }

  private async loadOrCreateToken(): Promise<string> {
    const file = path.join(this.storageDirectory, "bridge-token");
    try {
      const value = (await fs.readFile(file, "utf8")).trim();
      if (value.length >= 40) return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const value = randomBytes(32).toString("base64url");
    await fs.writeFile(file, value, { mode: 0o600 });
    return value;
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    this.setCorsHeaders(response, request);
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const url = new URL(request.url ?? "/", `http://${HOST}`);
    if (request.method === "GET" && url.pathname === "/health") {
      if (!this.authorized(request)) return this.sendJson(response, 401, { error: "Unauthorized" });
      return this.sendJson(response, 200, {
        ok: true,
        running: this.running,
        version: "1.2.3",
        profileId: this.profileId,
        catalogRequests: this.catalogRequestCount,
        runRequests: this.runRequestCount,
        activeRuns: this.activeRuns.size,
      });
    }
    if (!this.authorized(request)) {
      this.sendJson(response, 401, { error: "Unauthorized" });
      return;
    }

    try {
      if (this.disposed) { this.sendJson(response, 503, { error: "Antigravity service is disposed." }); return; }
      if (request.method === "GET" && url.pathname === "/mode") {
        this.sendJson(response, 200, { enabled: !this.paused, revision: this.revision }); return;
      }
      if (this.stopping) { this.sendJson(response, 503, { error: "Antigravity service is stopping." }); return; }
      if (request.method === "GET" && url.pathname === "/catalog") {
        this.catalogRequestCount += 1;
        if (this.paused) { this.sendJson(response, 200, { enabled: false, models: [], revision: this.revision }); return; }
        const models = this.catalogue ? this.models : await this.refreshCatalogue();
        this.sendJson(response, 200, { enabled: true, models, variants: this.catalogue?.availableModels.length ?? models.reduce((total, model) => total + model.variants.length, 0), revision: this.revision });
        return;
      }
      if (request.method === "GET" && url.pathname === "/status") {
        this.sendJson(response, 200, {
          running: !this.paused, connected: !this.paused && Boolean(this.catalogue), models: this.models,
          variants: this.catalogue?.availableModels.length ?? 0,
          active: this.activeRuns.size + this.preparingRuns,
          connecting: Boolean(this.catalogueRefreshPromise),
          error: this.catalogueError,
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/control") {
        const body = await this.readJsonBody(request);
        const action = body.action;
        if (action === "start") {
          await this.start();
          this.sendJson(response, 200, { accepted: true });
          return;
        }
        if (action === "refresh") {
          const models = await this.refreshCatalogue(true);
          this.sendJson(response, 200, { accepted: true, connected: true, models, variants: this.catalogue?.availableModels.length ?? 0, active: this.activeRuns.size + this.preparingRuns });
          return;
        }
        if (action === "reconnect") {
          const models = await this.reconnect();
          this.sendJson(response, 200, { accepted: true, connected: true, models, variants: this.catalogue?.availableModels.length ?? 0, active: this.activeRuns.size + this.preparingRuns });
          return;
        }
        if (action === "stop") {
          if (this.activeRuns.size || this.preparingRuns) {
            this.sendJson(response, 409, { accepted: false, error: "Agent 正在执行任务，请等待任务完成后再停止服务。" });
            return;
          }
          await this.stop();
          await this.onRemoteStop?.();
          this.sendJson(response, 200, { accepted: true });
          return;
        }
        this.sendJson(response, 400, { error: "Unsupported service control action." });
        return;
      }

      if (this.paused) { this.sendJson(response, 503, { error: "Antigravity service is stopped. Start it before using an Antigravity model." }); return; }
      const match = /^\/sessions\/([^/]+)\/(start|input|cancel)$/.exec(url.pathname);
      if (!match) {
        this.sendJson(response, 404, { error: "Not found" });
        return;
      }
      const runId = decodeURIComponent(match[1]);
      const action = match[2];

      if (request.method !== "POST") {
        this.sendJson(response, 405, { error: "Method not allowed" });
        return;
      }
      if (action === "start") {
        this.preparingRuns += 1;
        try {
          const body = await this.readJsonBody(request);
          await this.startRun(runId, body, response);
        } finally { this.preparingRuns -= 1; }
        return;
      }
      if (action === "input") {
        const body = await this.readJsonBody(request);
        this.acceptInput(runId, body.message);
        this.sendJson(response, 202, { accepted: true });
        return;
      }
      if (action === "cancel") {
        const run = this.activeRuns.get(runId);
        if (run && !run.cancelled) {
          run.cancelled = true;
          await this.acp.cancel(run.sessionId).catch(() => undefined);
        }
        this.sendJson(response, 200, { cancelled: Boolean(run) });
        return;
      }
    } catch (error) {
      const message = safeError(error);
      const repeatedCatalogueAuthFailure = url.pathname === "/catalog" &&
        /authentication required|please sign in|not signed in/i.test(message) &&
        Date.now() - this.lastCatalogErrorLoggedAt < 30_000;
      if (!repeatedCatalogueAuthFailure) {
        this.output.appendLine(`Gateway request failed: ${message}`);
        if (url.pathname === "/catalog" && /authentication required|please sign in|not signed in/i.test(message)) {
          this.lastCatalogErrorLoggedAt = Date.now();
        }
      }
      if (!response.headersSent) this.sendJson(response, 500, { error: message });
      else if (!response.destroyed && !response.writableEnded) {
        this.writeNdjson(response, { error: message });
        response.end();
      }
    }
  }

  private setCorsHeaders(response: ServerResponse, request: IncomingMessage): void {
    response.setHeader("Access-Control-Allow-Origin", request.headers.origin ?? "*");
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
    response.setHeader("Access-Control-Allow-Private-Network", "true");
    response.setHeader("Cache-Control", "no-store");
  }

  private authorized(request: IncomingMessage): boolean {
    return request.headers.authorization === `Bearer ${this.token}`;
  }

  private async readJsonBody(request: IncomingMessage): Promise<Record<string, any>> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += value.length;
      if (size > MAX_BODY_BYTES) throw new Error("Cursor request body exceeds the 20 MB limit.");
      chunks.push(value);
    }
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Cursor sent an invalid request body.");
    }
    return parsed as Record<string, any>;
  }

  private async startRun(runId: string, body: Record<string, any>, response: ServerResponse): Promise<void> {
    this.runRequestCount += 1;
    const first = body.first;
    const runRequest = getRunRequest(first);
    const conversationId = getConversationId(runRequest) || runId;
    const currentText = getUserText(runRequest);
    const modelId = getSelectedModelId(runRequest);

    if (!this.catalogue) await this.refreshCatalogue();
    await this.acp.start();
    const model = this.models.find((item) =>
      item.id === modelId || item.variants.some((variant) => variant.id === modelId),
    );
    if (!model) throw new Error(`Antigravity model "${modelId || "(empty)"}" is not in the current account catalogue.`);

    const nativeHistory = parseNativeHistory(body.history);
    let snapshot = nativeHistory ? nativeSnapshot(conversationId, nativeHistory) : emptySnapshot(conversationId);
    if (!nativeHistory && conversationId !== runId) {
      try {
        snapshot = this.reader.readConversation(conversationId);
      } catch (error) {
        this.output.appendLine(`Cursor context snapshot unavailable: ${safeError(error)}`);
      }
    }

    const { cwd, toolsEnabled } = sessionWorkspace(vscode.workspace.workspaceFolders, path.join(this.storageDirectory, "chat-only"));
    if (!toolsEnabled) await fs.mkdir(cwd, { recursive: true });

    let stored = await this.sessions.get(conversationId);
    if (stored && (nativeHistory
      ? stored.nativeHistoryFingerprint !== nativeHistoryFingerprint(snapshot.messages, nativeHistory.totalTurns)
      : Boolean(stored.nativeHistoryFingerprint) ||
        stored.lastVisibleMessageCount > snapshot.messages.length ||
        stored.lastAgentMessageCount > snapshot.agentMessages.length
    )) {
      await this.sessions.delete(conversationId);
      stored = undefined;
    }

    this.output.appendLine(`Starting Cursor conversation ${conversationId.slice(0, 12)} in ${cwd}`);
    const session = await this.ensureSession(conversationId, cwd, stored, toolsEnabled);
    const selection = resolveAcpModelSelection(model, getThinkingEffort(runRequest));
    await this.acp.setConfigOption(session.sessionId, "model", selection.model);
    if (selection.thoughtLevel) {
      await this.acp.setConfigOption(session.sessionId, "thought_level", selection.thoughtLevel);
    }

    const requestedMode = getRequestedMode(runRequest);
    const mode = requestedMode === 3 && this.catalogue?.modeOptions.includes("plan")
      ? "plan"
      : this.catalogue?.defaultMode;
    if (mode && this.catalogue?.modeOptions.includes(mode)) {
      await this.acp.setConfigOption(session.sessionId, "mode", mode);
    }

    const visibleDelta = session.isNew
      ? snapshot.messages
      : nativeHistory ? [] : snapshot.messages.slice(stored?.lastVisibleMessageCount ?? 0);
    const agentDelta = session.isNew
      ? snapshot.agentMessages
      : snapshot.agentMessages.slice(stored?.lastAgentMessageCount ?? 0);
    const contextMessages = nativeHistory ? visibleDelta : withoutCurrentUserMessage(visibleDelta, currentText);
    const contextAgentMessages = withoutCurrentUserMessage(agentDelta, currentText);
    const currentMessage = [...snapshot.messages].reverse().find((message) =>
      message.role === "user" && normalize(message.text) === normalize(currentText),
    );
    const contextText = buildContextSnapshot({
      ...snapshot,
      messages: contextMessages,
      agentMessages: contextAgentMessages,
    }, { maxChars: 24_000 });
    const attachmentContext = [
      currentMessage?.fileRefs.length
        ? "Files attached to the current request:\\n" + currentMessage.fileRefs.map((file) => "- " + file).join("\\n")
        : "",
      currentMessage?.imageCount
        ? "Image attachments detected: " + currentMessage.imageCount +
          ". Their image payload is not yet transferred to Antigravity; do not infer their contents."
        : "",
    ].filter(Boolean).join("\\n\\n");
    const promptText = buildPromptText(
      [contextText, attachmentContext].filter(Boolean).join("\\n\\n"),
      currentText || "Continue the current task using the imported Cursor conversation context.",
      [getCustomSystemPrompt(runRequest), !toolsEnabled ? "No local workspace is open. Respond in chat; ask the user to open a local folder if file or terminal operations are needed." : ""].filter(Boolean).join("\n"),
    );

    const active: ActiveRun = {
      sessionId: session.sessionId,
      cancelled: false,
      pendingInputs: [],
    };
    this.activeRuns.set(runId, active);
    response.on("close", () => {
      if (!response.writableEnded && !active.cancelled) {
        active.cancelled = true;
        void this.acp.cancel(active.sessionId).catch(() => undefined);
      }
    });
    response.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.flushHeaders();

    const modelMetadata = isRecord(first.modelMetadata) ? first.modelMetadata : { id: model.id, name: model.name };
    let projectedMessageCount = snapshot.messages.length +
      (containsCurrentUserMessage(snapshot, currentText) ? 1 : 2);
    let nextRunRequest = runRequest;
    let nextPrompt = promptText;
    let promptCount = 0;
    const completedNativeMessages = [...snapshot.messages].map(({role,text}) => ({role,text}));

    try {
      while (!active.cancelled && promptCount < 5) {
        const startedAt = Date.now();
        const result = await this.streamPrompt(
          session.sessionId,
          nextPrompt,
          nextRunRequest,
          modelMetadata,
          startedAt,
          response,
        );
        promptCount += 1;
        completedNativeMessages.push({ role: "user", text: getUserText(nextRunRequest) }, { role: "assistant", text: result.assistantText });
        projectedMessageCount += promptCount > 1 ? 2 : 0;

        if (result.stopReason === "cancelled" || active.cancelled || response.destroyed) break;
        await delay(IDLE_INPUT_WINDOW_MS);
        const followup = active.pendingInputs.shift();
        if (!followup) break;

        nextRunRequest = {
          ...runRequest,
          action: { userMessageAction: { userMessage: followup.userMessage } },
        };
        nextPrompt = followup.text;
      }

      if (!active.cancelled && !response.destroyed) {
        const record: CursorAcpSessionRecord = {
          composerId: conversationId,
          sessionId: session.sessionId,
          cwd,
          modelId: selection.model,
          lastVisibleMessageCount: projectedMessageCount,
          lastAgentMessageCount: snapshot.agentMessages.length,
          updatedAt: Date.now(),
          ...(nativeHistory ? { nativeHistoryFingerprint: nativeHistoryFingerprint(completedNativeMessages, nativeHistory.totalTurns + promptCount) } : {}),
        };
        await this.sessions.set(record);
        this.writeNdjson(response, { done: true });
        response.end();
      }
    } catch (error) {
      const message = safeError(error);
      this.output.appendLine(`Antigravity turn failed: ${message}`);
      if (!response.destroyed && !response.writableEnded) {
        this.writeNdjson(response, { error: message });
        response.end();
      }
    } finally {
      this.activeRuns.delete(runId);
    }
  }

  private async ensureSession(
    composerId: string,
    cwd: string,
    stored?: CursorAcpSessionRecord,
    toolsEnabled = true,
  ): Promise<{ sessionId: string; isNew: boolean }> {
    if (stored && samePath(stored.cwd, cwd)) {
      try {
        await this.acp.loadSession(stored.sessionId, cwd, toolsEnabled);
        return { sessionId: stored.sessionId, isNew: false };
      } catch (error) {
        this.output.appendLine(`Stored Antigravity session could not be resumed; creating a new session: ${safeError(error)}`);
        await this.sessions.delete(composerId);
      }
    }
    const created = await this.acp.createSession(cwd, toolsEnabled);
    return { sessionId: created.sessionId, isNew: true };
  }

  private async streamPrompt(
    sessionId: string,
    prompt: string,
    runRequest: Record<string, any>,
    modelMetadata: Record<string, any>,
    startedAt: number,
    response: ServerResponse,
  ): Promise<{ stopReason: string; assistantText: string }> {
    const queue = new AsyncQueue<import("@agentclientprotocol/sdk").SessionUpdate>();
    const unsubscribe = this.acp.onSessionUpdate((notification) => {
      if (notification.sessionId === sessionId) queue.push(notification.update);
    });
    const promptPromise = this.acp.prompt(sessionId, prompt);
    void promptPromise.then(
      () => queue.close(),
      (error) => queue.fail(error),
    );

    const assistantText: string[] = [];
    const toolSteps = new Map<string, Record<string, any>>();
    const toolCalls = new Map<string, Record<string, any>>();

    try {
      for await (const update of queue) {
        const raw = update as unknown as Record<string, any>;
        if (raw.sessionUpdate === "agent_message_chunk" &&
            raw.content?.type === "text" && typeof raw.content.text === "string") {
          assistantText.push(raw.content.text);
        }
        if (raw.sessionUpdate === "tool_call" && typeof raw.toolCallId === "string") {
          toolCalls.set(raw.toolCallId, raw);
        }
        const previous = typeof raw.toolCallId === "string" ? toolCalls.get(raw.toolCallId) : undefined;
        const normalized = raw.sessionUpdate === "tool_call_update" && previous
          ? { ...previous, ...raw }
          : raw;
        if (raw.sessionUpdate === "tool_call_update" && typeof raw.toolCallId === "string") {
          toolCalls.set(raw.toolCallId, normalized);
        }
        for (const adapted of adaptSessionUpdate(normalized as unknown as import("@agentclientprotocol/sdk").SessionUpdate)) {
          if (adapted.message) this.writeNdjson(response, { message: adapted.message });
          if (adapted.toolCallId && adapted.toolStep) {
            toolSteps.set(adapted.toolCallId, adapted.toolStep);
          }
        }
      }

      const result = await promptPromise;
      const checkpoint = buildCheckpointData({
        runRequest,
        modelMetadata,
        assistantText: assistantText.join(""),
        toolSteps: [...toolSteps.values()],
        startedAt,
        stopReason: result.stopReason,
      });
      if (!response.destroyed && !response.writableEnded) {
        this.writeNdjson(response, { checkpoint });
      }
      return { stopReason: result.stopReason, assistantText: checkpoint.steps.at(-1)?.assistantMessage?.text ?? "" };
    } finally {
      unsubscribe();
    }
  }

  private acceptInput(runId: string, message: unknown): void {
    const active = this.activeRuns.get(runId);
    if (!active || active.cancelled || !isRecord(message)) return;
    const envelope = isRecord(message.message) ? message.message : undefined;
    const action = isRecord(message.conversationAction)
      ? message.conversationAction
      : isRecord(envelope?.conversationAction) ? envelope.conversationAction
      : envelope?.case === "conversationAction" && isRecord(envelope.value) ? envelope.value
      : message.case === "conversationAction" && isRecord(message.value) ? message.value
      : undefined;
    if (!action) return;
    const normalizedAction = action.case === "userMessageAction" && isRecord(action.value)
      ? action.value
      : action;
    const userAction = normalizedAction.userMessageAction ?? normalizedAction.user_message_action ?? normalizedAction;
    const userMessage = isRecord(userAction?.userMessage)
      ? userAction.userMessage
      : isRecord(userAction?.user_message) ? userAction.user_message : undefined;
    const text = typeof userMessage?.text === "string" ? userMessage.text.trim() : "";
    if (userMessage && text) active.pendingInputs.push({ userMessage, text });
  }

  private writeNdjson(response: ServerResponse, value: unknown): void {
    if (!response.destroyed && !response.writableEnded) {
      response.write(JSON.stringify(value) + "\n");
    }
  }

  private sendJson(response: ServerResponse, status: number, value: unknown): void {
    if (response.destroyed || response.writableEnded) return;
    const body = JSON.stringify(value);
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    response.end(body);
  }
}

function defaultWorkspaceDirectory(): string {
  const candidates = [process.env.INIT_CWD, process.cwd()];
  for (const candidate of candidates) {
    if (candidate && path.isAbsolute(candidate) &&
        !isCursorResources(candidate)) {
      return candidate;
    }
  }
  return homedir();
}

function emptySnapshot(composerId: string): CursorConversationSnapshot {
  return {
    composerId,
    messages: [],
    agentMessages: [],
    workspaceUris: [],
    missingMessages: 0,
    missingAgentBlobs: 0,
    agentBlobCount: 0,
  };
}

function containsCurrentUserMessage(snapshot: CursorConversationSnapshot, currentText: string): boolean {
  if (!currentText) return false;
  return snapshot.messages.some((message) =>
    message.role === "user" && normalize(message.text) === normalize(currentText),
  );
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "[REDACTED]")
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[REDACTED]")
    .replace(/\bBearer\s+[^\s]+/gi, "Bearer [REDACTED]")
    .slice(0, 800);
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
