import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { Readable, Writable } from "node:stream";
import { client, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";

const agy = process.env.AGY_PATH || `${homedir()}/.local/bin/agy`;
const child = spawn(agy, ["acp", "--disable-telemetry"], {
  cwd: "/tmp",
  stdio: ["pipe", "pipe", "pipe"],
});

let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr = (stderr + chunk).slice(-4000);
});

const stream = ndJsonStream(
  Writable.toWeb(child.stdin),
  Readable.toWeb(child.stdout),
);

const app = client({ name: "antigravity-cursor-probe" });
const connection = app.connect(stream);

const timeout = setTimeout(() => {
  child.kill("SIGTERM");
  process.exitCode = 2;
}, 30_000);

try {
  const initialized = await connection.agent.request("initialize", {
    protocolVersion: PROTOCOL_VERSION,
    clientInfo: { name: "antigravity-cursor-probe", version: "1.1.0" },
    clientCapabilities: {},
  });

  const session = await connection.agent.request("session/new", {
    cwd: "/tmp",
    mcpServers: [],
  });

  const models = session.models?.availableModels ?? [];
  const options = session.configOptions ?? [];

  console.log(JSON.stringify({
    protocolVersion: initialized.protocolVersion,
    agentName: initialized.agentInfo?.name ?? "Antigravity",
    sessionCreated: Boolean(session.sessionId),
    availableModels: models.map((item) => ({
      modelId: item.modelId,
      name: item.name,
    })),
    configOptions: options.map((item) => ({
      id: item.id,
      name: item.name,
      currentValue: item.currentValue,
      values: item.options?.map((option) => option.value) ?? [],
    })),
  }, null, 2));

  await connection.agent.request("session/close", {
    sessionId: session.sessionId,
  });
} catch (error) {
  console.error("ACP probe failed:", error instanceof Error ? error.message : String(error));
  if (stderr.trim()) console.error("ACP stderr:", stderr.trim().slice(-1200));
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  connection.close();
  child.kill("SIGTERM");
}
