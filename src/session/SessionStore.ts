import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export interface CursorAcpSessionRecord {
  composerId: string;
  sessionId: string;
  cwd: string;
  modelId: string;
  lastVisibleMessageCount: number;
  lastAgentMessageCount: number;
  updatedAt: number;
  nativeHistoryFingerprint?: string;
}

interface StoreFile {
  schema: 1;
  sessions: CursorAcpSessionRecord[];
}

export class SessionStore {
  private readonly filePath: string;
  private readonly sessions = new Map<string, CursorAcpSessionRecord>();
  private loaded = false;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(storageDirectory: string) {
    this.filePath = path.join(storageDirectory, "sessions.json");
  }

  async get(composerId: string): Promise<CursorAcpSessionRecord | undefined> {
    await this.load();
    const value = this.sessions.get(composerId);
    return value ? { ...value } : undefined;
  }

  async set(record: CursorAcpSessionRecord): Promise<void> {
    await this.load();
    this.sessions.set(record.composerId, { ...record, updatedAt: Date.now() });
    await this.persist();
  }

  async delete(composerId: string): Promise<void> {
    await this.load();
    this.sessions.delete(composerId);
    await this.persist();
  }

  async dispose(): Promise<void> {
    await this.writeQueue;
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as StoreFile;
      if (parsed.schema !== 1 || !Array.isArray(parsed.sessions)) return;
      for (const item of parsed.sessions) {
        if (!item || typeof item.composerId !== "string" || typeof item.sessionId !== "string") continue;
        if (typeof item.cwd !== "string" || typeof item.modelId !== "string") continue;
        this.sessions.set(item.composerId, {
          composerId: item.composerId,
          sessionId: item.sessionId,
          cwd: item.cwd,
          modelId: item.modelId,
          lastVisibleMessageCount: Math.max(0, Number(item.lastVisibleMessageCount) || 0),
          lastAgentMessageCount: Math.max(0, Number(item.lastAgentMessageCount) || 0),
          updatedAt: Number(item.updatedAt) || 0,
          ...(typeof item.nativeHistoryFingerprint === "string" && /^[a-f0-9]{64}$/.test(item.nativeHistoryFingerprint) ? { nativeHistoryFingerprint: item.nativeHistoryFingerprint } : {}),
        });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error("Antigravity session store could not be read: " + String(error));
      }
    }
  }

  private persist(): Promise<void> {
    const operation = this.writeQueue.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const payload: StoreFile = { schema: 1, sessions: [...this.sessions.values()] };
      const temporary = this.filePath + "." + randomUUID() + ".tmp";
      try {
        await fs.writeFile(temporary, JSON.stringify(payload, null, 2), { mode: 0o600 });
        await fs.rename(temporary, this.filePath);
      } catch (error) {
        await fs.unlink(temporary).catch(() => undefined);
        throw error;
      }
    });
    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }
}
