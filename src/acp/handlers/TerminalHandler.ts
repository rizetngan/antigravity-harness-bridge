import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  CreateTerminalRequest,
  CreateTerminalResponse,
  KillTerminalRequest,
  KillTerminalResponse,
  ReleaseTerminalRequest,
  ReleaseTerminalResponse,
  TerminalOutputRequest,
  TerminalOutputResponse,
  WaitForTerminalExitRequest,
  WaitForTerminalExitResponse,
} from "@agentclientprotocol/sdk";

interface ManagedTerminal {
  sessionId: string;
  process: ChildProcess;
  output: string;
  truncated: boolean;
  outputByteLimit: number;
  exitCode: number | null;
  exitSignal: string | null;
  exited: boolean;
  exitPromise: Promise<void>;
}

export class TerminalHandler {
  private readonly terminals = new Map<string, ManagedTerminal>();

  constructor(private readonly getRoots: (sessionId: string) => string[]) {}

  async createTerminal(params: CreateTerminalRequest): Promise<CreateTerminalResponse> {
    const cwd = await this.assertAllowedCwd(params.sessionId, params.cwd);
    const env: Record<string, string> = { ...process.env } as Record<string, string>;
    for (const variable of params.env ?? []) env[variable.name] = variable.value;

    const child = spawn(params.command, params.args ?? [], {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const terminalId = randomUUID();
    const outputByteLimit = Math.max(1024, params.outputByteLimit ?? 1024 * 1024);
    const managed: ManagedTerminal = {
      sessionId: params.sessionId,
      process: child,
      output: "",
      truncated: false,
      outputByteLimit,
      exitCode: null,
      exitSignal: null,
      exited: false,
      exitPromise: new Promise<void>((resolve) => {
        child.once("close", (code, signal) => {
          managed.exitCode = code;
          managed.exitSignal = signal;
          managed.exited = true;
          resolve();
        });
        child.once("error", () => {
          managed.exited = true;
          resolve();
        });
      }),
    };
    this.terminals.set(terminalId, managed);

    const append = (chunk: Buffer) => {
      managed.output += chunk.toString("utf8");
      const bytes = Buffer.byteLength(managed.output, "utf8");
      if (bytes > managed.outputByteLimit) {
        const buffer = Buffer.from(managed.output, "utf8");
        managed.output = buffer.subarray(bytes - managed.outputByteLimit).toString("utf8");
        managed.truncated = true;
      }
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    return { terminalId };
  }

  async terminalOutput(params: TerminalOutputRequest): Promise<TerminalOutputResponse> {
    const terminal = this.requireTerminal(params.sessionId, params.terminalId);
    return {
      output: terminal.output,
      truncated: terminal.truncated,
      ...(terminal.exited
        ? { exitStatus: { exitCode: terminal.exitCode, signal: terminal.exitSignal } }
        : {}),
    };
  }

  async waitForTerminalExit(params: WaitForTerminalExitRequest): Promise<WaitForTerminalExitResponse> {
    const terminal = this.requireTerminal(params.sessionId, params.terminalId);
    await terminal.exitPromise;
    return { exitCode: terminal.exitCode, signal: terminal.exitSignal };
  }

  async killTerminal(params: KillTerminalRequest): Promise<KillTerminalResponse> {
    const terminal = this.requireTerminal(params.sessionId, params.terminalId);
    if (!terminal.exited) terminal.process.kill("SIGTERM");
    return {};
  }

  async releaseTerminal(params: ReleaseTerminalRequest): Promise<ReleaseTerminalResponse> {
    const terminal = this.requireTerminal(params.sessionId, params.terminalId);
    if (!terminal.exited) terminal.process.kill("SIGTERM");
    this.terminals.delete(params.terminalId);
    return {};
  }

  dispose(): void {
    for (const terminal of this.terminals.values()) {
      if (!terminal.exited) terminal.process.kill("SIGTERM");
    }
    this.terminals.clear();
  }

  private requireTerminal(sessionId: string, id: string): ManagedTerminal {
    const terminal = this.terminals.get(id);
    if (!terminal || terminal.sessionId !== sessionId) throw new Error("Unknown Antigravity terminal: " + id);
    return terminal;
  }

  private async assertAllowedCwd(sessionId: string, cwd?: string | null): Promise<string> {
    const roots = this.getRoots(sessionId);
    if (!roots.length) throw new Error("No workspace root is registered for this Antigravity session.");
    const target = await fs.realpath(cwd || roots[0]);
    for (const root of roots) {
      const resolvedRoot = await fs.realpath(root).catch(() => path.resolve(root));
      const relative = path.relative(resolvedRoot, target);
      if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return target;
    }
    throw new Error("Antigravity terminal execution is restricted to the current workspace.");
  }
}
