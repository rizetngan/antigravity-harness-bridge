import type { ClientApp } from "@agentclientprotocol/sdk";
import { FileSystemHandler } from "./handlers/FileSystemHandler.js";
import { PermissionHandler } from "./handlers/PermissionHandler.js";
import { TerminalHandler } from "./handlers/TerminalHandler.js";

export class AcpClientHandlers {
  private readonly sessionRoots = new Map<string, string[]>();
  private readonly fileSystem = new FileSystemHandler((sessionId) => this.rootsFor(sessionId));
  private readonly terminal = new TerminalHandler((sessionId) => this.rootsFor(sessionId));
  private readonly permissions = new PermissionHandler();

  register(app: ClientApp): void {
    app.onRequest("session/request_permission", ({ params }) =>
      this.permissions.requestPermission(params),
    );
    app.onRequest("fs/read_text_file", ({ params }) =>
      this.fileSystem.readTextFile(params),
    );
    app.onRequest("fs/write_text_file", ({ params }) =>
      this.fileSystem.writeTextFile(params),
    );
    app.onRequest("terminal/create", ({ params }) =>
      this.terminal.createTerminal(params),
    );
    app.onRequest("terminal/output", ({ params }) =>
      this.terminal.terminalOutput(params),
    );
    app.onRequest("terminal/wait_for_exit", ({ params }) =>
      this.terminal.waitForTerminalExit(params),
    );
    app.onRequest("terminal/kill", ({ params }) =>
      this.terminal.killTerminal(params),
    );
    app.onRequest("terminal/release", ({ params }) =>
      this.terminal.releaseTerminal(params),
    );
  }

  registerSession(sessionId: string, roots: readonly string[]): void {
    this.sessionRoots.set(sessionId, [...roots]);
  }

  unregisterSession(sessionId: string): void {
    this.sessionRoots.delete(sessionId);
  }

  dispose(): void {
    this.terminal.dispose();
    this.sessionRoots.clear();
  }

  private rootsFor(sessionId: string): string[] {
    return this.sessionRoots.get(sessionId) ?? [];
  }
}
