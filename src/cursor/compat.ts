import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export const START = "/* ANTIGRAVITY_BRIDGE_RUNTIME_START v1 */";
export const END = "/* ANTIGRAVITY_BRIDGE_RUNTIME_END v1 */";
export const EXTENSION_ID = "rizetngan.antigravity-cursor";

const MODEL_GETTER = "getAvailableDefaultModels(){return[...this._availableDefaultModels()]}";
const BRIDGE_GETTER = "getAvailableDefaultModels(){/* ANTIGRAVITY_MODEL_GETTER */return globalThis.__antigravityBridge?globalThis.__antigravityBridge.mergeModels(this,[...this._availableDefaultModels()]):[...this._availableDefaultModels()]}";
const AGENT_HOST_ASSIGN = /this\._agentHostEnabled=[^,;]{1,200},/;
const MODEL_AVAILABILITY_GUARD = 'const f=d.split(",").map(v=>v.trim()).filter(v=>v.length>0),p=f.map(v=>JXm(v,n,s));if(!(p.length>0&&p.every(v=>n.includes(v)))';
const MODEL_AVAILABILITY_SEAM = 'if(f.length>0&&f.every(v=>globalThis.__antigravityBridge?.registeredModel?.(v,l)))return u;';
const DESKTOP_MODEL_AVAILABILITY_GUARD = 'const f=d.split(",").map(_=>_.trim()).filter(_=>_.length>0),g=f.map(_=>Cdp(_,i,s));if(!(g.length>0&&g.every(_=>i.includes(_)))';
const DESKTOP_MODEL_AVAILABILITY_SEAM = 'if(f.length>0&&f.every(_=>globalThis.__antigravityBridge?.registeredModel?.(_,l)))return u;';
const GLASS_BASE_LIST = /([\w$]+)=\["anysphere\.cursor-resolver","anysphere\.cursor-always-local",/g;
const GLASS_SEAM_MARK = "/* ANTIGRAVITY_GLASS_EXTENSION */";
const GLASS_SEAM_TEXT = GLASS_SEAM_MARK + JSON.stringify(EXTENSION_ID) + ",";

const NATIVE_TYPES = ["UserMessage", "ConversationStep", "ConversationTurnStructure"];
const STRATEGY = /this\._executionStrategy=([\w$]+\?\.executionStrategy\?\?new [\w$]+\(this\.agentClientService\)),/g;
const STRATEGY_MARK = "/* ANTIGRAVITY_TURN_STRATEGY */";
const STRATEGY_PATCH = /this\._executionStrategy=\/\* ANTIGRAVITY_TURN_STRATEGY \*\//g;
const FACTORY = /function ([\w$]+)\(([\w$]+),([\w$]+)\)\{return ([\w$]+)\(\2,\3\)\}/g;
const WRAPPED_FACTORY = /function ([\w$]+)\(([\w$]+),([\w$]+)\)\{const __agClient=([\w$]+)\(\2,\3\);return globalThis\.__antigravityBridge\?globalThis\.__antigravityBridge\.wrapClient\(__agClient,\2\):__agClient\}/g;

// Native picker seams: operate on model arrays after the host applies its own
// availability/visibility rules. Preserve the full internal catalogue and preferences.
const PICKER_LIST = /(let ([\w$]+)=[\w$]+\([\w$]+,[\w$]+,[\w$]+,[\w$]+\(\)\);)(return [\w$]+==="background-composer"&&\(\2=[\w$]+\(\2\)\),[\w$]+\(\2,[\w$]+\)\?[\w$]+:\([\w$]+=\2,\2\))/g;
const LEGACY_PICKER = /(getAvailableModelsReactiveWithStatus\([\w$]+\)\{let ([\w$]+);[\s\S]{1,5000}?)(return \2)(\}_setUseOpenAIKey\()/g;
const SETTINGS_PICKER = /return (this\.modelConfigService\.getAvailableDefaultModels\(\)\.filter\(([\w$]+)=>!\2\.isLongContextOnly&&!this\.getHardcodedLongContextOnlyModelNames\(\)\.includes\(\2\.name\)\)\.map\(\2=>[\w$]+\(\2\)\))(?=\},this\.isModelDisabled=)/g;
const PICKER_PROPS = /(models:([\w$]+)\(\),initialSelections:[\w$]+\(\),initialMultiModelMode:[\s\S]{1,2500}?defaultVisibleModelIds:)([\w$]+\(\))([\s\S]{1,2000}?hideAutoToggle:)([\w$]+\(\)\|\|[\w$]+\(\))/g;
const PICKER_LIST_MARK = "/* ANTIGRAVITY_PROVIDER_PICKER */";
const LEGACY_PICKER_MARK = "/* ANTIGRAVITY_PROVIDER_LEGACY */";
const SETTINGS_PICKER_MARK = "/* ANTIGRAVITY_PROVIDER_SETTINGS */";
const PICKER_PROPS_MARK = "/* ANTIGRAVITY_PROVIDER_PROPS */";
const TARGET_SPECS = [
  { key: "vs/workbench/workbench.desktop.main.js", file: "workbench.desktop.main.js", kind: "desktop", backup: "workbench.original.js" },
  { key: "vs/workbench/workbench.glass.main.js", file: "workbench.glass.main.js", kind: "glass", backup: "glass.original.js" },
];

export interface CompatibilityOptions {
  allowOriginalApp?: boolean;
}

export interface CompatibilityAnchor {
  id: string;
  count: number;
  patched: number;
  required: boolean;
  ok: boolean;
}

export interface CompatibilityTargetPlan {
  key: string;
  file: string;
  kind: string;
  backup: string;
  path: string;
  source: string;
  patched: string;
  originalHash: string;
  patchedHash: string;
}

export interface CompatibilityPlan {
  appRoot: string;
  storagePath: string;
  productPath: string;
  targets: CompatibilityTargetPlan[];
  productBytes: Buffer;
  patchedProduct: Buffer;
  productHash: string;
  patchedProductHash: string;
}

export function digest(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function anchorCounts(source: string): { adapter: boolean; ok: boolean; anchors: CompatibilityAnchor[] } {
  const endAt = source.startsWith(START) ? source.indexOf(END) : -1;
  const body = endAt >= 0 ? source.slice(endAt + END.length) : source;
  const marker = body.indexOf('"promise-client.js"');
  const factories = marker < 0 ? 0 : [...body.matchAll(FACTORY)]
    .filter((match) => (match.index ?? -1) < marker && (match.index ?? -1) > marker - 6000).length;
  const wrappedFactories = [...body.matchAll(WRAPPED_FACTORY)].length;
  const getterCount = body.split(MODEL_GETTER).length - 1;
  const bridgeGetterCount = body.split(BRIDGE_GETTER).length - 1;
  const glassSeams = body.split(GLASS_SEAM_TEXT).length - 1;
  const modelAvailabilityGuards = body.split(MODEL_AVAILABILITY_GUARD).length - 1;
  const modelAvailabilitySeams = body.split(MODEL_AVAILABILITY_SEAM).length - 1;
  const desktopModelAvailabilityGuards = body.split(DESKTOP_MODEL_AVAILABILITY_GUARD).length - 1;
  const desktopModelAvailabilitySeams = body.split(DESKTOP_MODEL_AVAILABILITY_SEAM).length - 1;
  const anchors: CompatibilityAnchor[] = [
    { id: "promise_client", count: body.split('"promise-client.js"').length - 1, patched: 0, required: true, ok: false },
    { id: "client_factory", count: factories, patched: wrappedFactories, required: true, ok: false },
    { id: "model_getter", count: getterCount, patched: bridgeGetterCount, required: true, ok: false },
    { id: "turn_strategy", count: [...body.matchAll(STRATEGY)].length, patched: [...body.matchAll(STRATEGY_PATCH)].length, required: false, ok: false },
    ...NATIVE_TYPES.map((type) => {
      const pattern = new RegExp('([\\w$]+)=([\\w$]+)\\.makeMessageType\\("agent\\.v1\\.' + type + '"', "g");
      return { id: "type_" + type, count: [...body.matchAll(pattern)].length, patched: 0, required: true, ok: false };
    }),
    {
      id: "agent_host",
      count: [...body.matchAll(new RegExp(AGENT_HOST_ASSIGN.source, "g"))].length,
      patched: 0,
      required: false,
      ok: false,
    },
    {
      id: "model_availability",
      count: modelAvailabilityGuards,
      patched: modelAvailabilitySeams,
      required: false,
      ok: false,
    },
    { id: "model_availability_desktop", count: desktopModelAvailabilityGuards, patched: desktopModelAvailabilitySeams, required: false, ok: false },
    {
      id: "glass_list",
      count: [...body.matchAll(new RegExp(GLASS_BASE_LIST.source, "g"))].length,
      patched: glassSeams,
      required: false,
      ok: false,
    },
  ];

  for (const [id, pattern, mark] of [
    ["provider_picker", PICKER_LIST, PICKER_LIST_MARK],
    ["provider_legacy", LEGACY_PICKER, LEGACY_PICKER_MARK],
    ["provider_settings", SETTINGS_PICKER, SETTINGS_PICKER_MARK],
    ["provider_props", PICKER_PROPS, PICKER_PROPS_MARK],
  ] as const) {
    anchors.push({ id, count: [...body.matchAll(pattern)].length, patched: body.split(mark).length - 1, required: false, ok: false });
  }
  for (const anchor of anchors) {
    const total = anchor.count + anchor.patched;
    anchor.ok = anchor.required ? total === 1 : total <= 1;
  }
  return { adapter: endAt >= 0, ok: anchors.every((anchor) => anchor.ok), anchors };
}

export function patchSource(
  source: string,
  renderer: string,
  config: { url: string; token: string },
): string {
  if (source.includes(START)) throw new Error("Antigravity compatibility is already installed.");
  const marker = source.indexOf('"promise-client.js"');
  if (marker < 0) throw new Error("Cursor model client entry was not found.");

  const candidates = [...source.matchAll(FACTORY)]
    .filter((match) => (match.index ?? -1) < marker && (match.index ?? -1) > marker - 6000);
  if (candidates.length !== 1) throw new Error("Cursor gRPC client factory is ambiguous.");

  const match = candidates[0];
  const [, name, service, transport, factory] = match;
  const replacement = `function ${name}(${service},${transport}){const __agClient=${factory}(${service},${transport});return globalThis.__antigravityBridge?globalThis.__antigravityBridge.wrapClient(__agClient,${service}):__agClient}`;

  const strategies = [...source.matchAll(STRATEGY)];
  if (strategies.length > 1) throw new Error("Cursor turn execution strategy is ambiguous.");
  const nativeTypes = strategies.length ? [...NATIVE_TYPES, "AgentServerMessage"] : NATIVE_TYPES;
  const typeCases = nativeTypes.map((type) => {
    const pattern = new RegExp('([\\w$]+)=([\\w$]+)\\.makeMessageType\\("agent\\.v1\\.' + type + '"', "g");
    const found = [...source.matchAll(pattern)];
    if (found.length !== 1) throw new Error("Cursor native message type is missing or ambiguous: " + type);
    return `case ${JSON.stringify(type)}:return ${found[0][1]};`;
  });

  if (source.split(MODEL_GETTER).length !== 2) throw new Error("Cursor model catalogue getter is missing or ambiguous.");
  if (!renderer.includes("__ANTIGRAVITY_BRIDGE_CONFIG__")) throw new Error("Renderer configuration placeholder is missing.");

  const runtime = renderer.replace("__ANTIGRAVITY_BRIDGE_CONFIG__", JSON.stringify(config)) +
    `\nglobalThis.__antigravityBridge.nativeType=function(name){switch(name){${typeCases.join("")}default:throw new Error("Unsupported native type")}};`;

  let body = (
    source.slice(0, match.index) + replacement + source.slice((match.index ?? 0) + match[0].length)
  ).replace(MODEL_GETTER, BRIDGE_GETTER);

  if (strategies.length === 1) {
    body = body.replace(STRATEGY, (_whole, strategy: string) =>
      `this._executionStrategy=${STRATEGY_MARK}(globalThis.__antigravityBridge?.wrapExecutionStrategy?.(${strategy})??(${strategy})),`);
  }
  const assignments = [...body.matchAll(new RegExp(AGENT_HOST_ASSIGN.source, "g"))];
  if (assignments.length > 1) throw new Error("Cursor Agent Host switch is ambiguous.");

  const modelAvailabilityCount = body.split(MODEL_AVAILABILITY_GUARD).length - 1;
  if (modelAvailabilityCount > 1) throw new Error("Cursor model availability guard is ambiguous.");
  if (modelAvailabilityCount === 1) {
    body = body.replace(
      MODEL_AVAILABILITY_GUARD,
      MODEL_AVAILABILITY_GUARD.replace(";if(!(", ";" + MODEL_AVAILABILITY_SEAM + "if(!("),
    );
  }

  const desktopModelAvailabilityCount = body.split(DESKTOP_MODEL_AVAILABILITY_GUARD).length - 1;
  if (desktopModelAvailabilityCount > 1) throw new Error("Cursor desktop model availability guard is ambiguous.");
  if (desktopModelAvailabilityCount === 1) {
    body = body.replace(
      DESKTOP_MODEL_AVAILABILITY_GUARD,
      DESKTOP_MODEL_AVAILABILITY_GUARD.replace(";if(!(", ";" + DESKTOP_MODEL_AVAILABILITY_SEAM + "if(!("),
    );
  }

  const glassLists = [...body.matchAll(GLASS_BASE_LIST)];
  if (glassLists.length > 1) throw new Error("Cursor Glass extension allowlist is ambiguous.");
  if (glassLists.length === 1) {
    const at = (glassLists[0].index ?? 0) + glassLists[0][0].indexOf("[") + 1;
    body = body.slice(0, at) + GLASS_SEAM_TEXT + body.slice(at);
  }

  for (const [id, pattern] of [["provider picker", PICKER_LIST], ["legacy picker", LEGACY_PICKER], ["settings picker", SETTINGS_PICKER], ["picker props", PICKER_PROPS]] as const) {
    const matches = [...body.matchAll(pattern)];
    if (matches.length > 1) throw new Error("Ambiguous Cursor " + id + " seam.");
  }
  body = body.replace(PICKER_LIST, (_all, head: string, variable: string, tail: string) =>
    head + PICKER_LIST_MARK + variable + "=globalThis.__antigravityBridge?.filterVisibleModels?.(" + variable + ")??" + variable + ";" + tail);
  body = body.replace(LEGACY_PICKER, (_all, head: string, variable: string, _return: string, tail: string) =>
    head + LEGACY_PICKER_MARK + "return globalThis.__antigravityBridge?.filterVisibleModels?.(" + variable + ")??" + variable + tail);
  body = body.replace(SETTINGS_PICKER, (_all, expression: string) =>
    "return " + SETTINGS_PICKER_MARK + "(function(__agModels){return globalThis.__antigravityBridge?.filterVisibleModels?.(__agModels)??__agModels})(" + expression + ")");
  body = body.replace(PICKER_PROPS, (_all, head: string, models: string, ids: string, middle: string, hideAuto: string) =>
    head + PICKER_PROPS_MARK + "(function(__agIds){return globalThis.__antigravityBridge?.preferredVisibleIds?.(__agIds," + models + "())??__agIds})(" + ids + ")" + middle + "(" + hideAuto + "||globalThis.__antigravityBridge?.isProviderActive?.()===true)");
  return START + "\n" + runtime + "\n" + END + "\n" + body;
}

async function atomicWrite(file: string, bytes: Buffer): Promise<void> {
  const temporary = file + ".antigravity-" + randomBytes(6).toString("hex") + ".tmp";
  const stat = await fs.stat(file).catch(() => undefined);
  try {
    await fs.writeFile(temporary, bytes, { mode: stat?.mode ?? 0o600 });
    if (stat && typeof process.getuid === "function" && process.getuid() === 0) {
      await fs.chown(temporary, stat.uid, stat.gid);
    }
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export class CursorCompatibility {
  private readonly appRoot: string;
  private readonly storagePath: string;
  private readonly rendererPath: string;
  private readonly productPath: string;
  private readonly targets: Array<(typeof TARGET_SPECS)[number] & { path: string }>;
  private readonly options: CompatibilityOptions;

  constructor(appRoot: string, storagePath: string, rendererPath: string, options: CompatibilityOptions = {}) {
    this.appRoot = path.resolve(appRoot);
    this.storagePath = storagePath;
    this.rendererPath = rendererPath;
    this.productPath = path.join(this.appRoot, "product.json");
    this.options = options;
    this.targets = TARGET_SPECS
      .filter((target) => target.kind === "desktop" || pathExistsSync(path.join(this.appRoot, "out", "vs", "workbench", target.file)))
      .filter((target) => target.kind === "desktop" ? pathExistsSync(path.join(this.appRoot, "out", "vs", "workbench", target.file)) : true)
      .map((target) => ({ ...target, path: path.join(this.appRoot, "out", "vs", "workbench", target.file) }));
  }

  async anchors() {
    const result = [];
    for (const target of this.targets) {
      const source = await fs.readFile(target.path, "utf8");
      result.push({ kind: target.kind, file: target.file, ...anchorCounts(source) });
    }
    return result;
  }

  async plan(config: { url: string; token: string }): Promise<CompatibilityPlan> {
    const renderer = await fs.readFile(this.rendererPath, "utf8");
    const targets: CompatibilityTargetPlan[] = [];
    for (const target of this.targets) {
      const source = await fs.readFile(target.path, "utf8");
      const patched = patchSource(source, renderer, config);
      targets.push({
        ...target,
        source,
        patched,
        originalHash: digest(source),
        patchedHash: digest(patched),
      });
    }

    const productBytes = await fs.readFile(this.productPath);
    const product = JSON.parse(productBytes.toString("utf8")) as {
      checksums?: Record<string, string>;
    };
    let patchedProduct = productBytes;
    if (product.checksums) {
      let checksumChanged = false;
      for (const target of targets) {
        if (!Object.hasOwn(product.checksums, target.key)) continue;
        product.checksums[target.key] = createHash("sha256")
          .update(target.patched)
          .digest("base64")
          .replace(/=+$/, "");
        checksumChanged = true;
      }
      if (checksumChanged) {
        patchedProduct = Buffer.from(JSON.stringify(product, null, "\t"));
      }
    }

    return {
      appRoot: this.appRoot,
      storagePath: this.storagePath,
      productPath: this.productPath,
      targets,
      productBytes,
      patchedProduct,
      productHash: digest(productBytes),
      patchedProductHash: digest(patchedProduct),
    };
  }

  async install(plan: CompatibilityPlan): Promise<void> {
    if (this.isDailyCursorApp() && !this.options.allowOriginalApp) {
      throw new Error("Refusing to patch the daily Cursor installation. Use an isolated Cursor test copy first.");
    }
    for (const target of plan.targets) {
      if (digest(await fs.readFile(target.path)) !== target.originalHash) {
        throw new Error("Cursor changed after the compatibility check. Re-run the plan.");
      }
    }
    if (digest(await fs.readFile(this.productPath)) !== plan.productHash) {
      throw new Error("Cursor product.json changed after the compatibility check.");
    }

    const backup = path.join(this.storagePath, "backups", plan.targets[0].originalHash);
    await fs.mkdir(backup, { recursive: true });
    for (const target of plan.targets) {
      await writeBackup(path.join(backup, target.backup), Buffer.from(target.source), target.originalHash);
    }
    await writeBackup(path.join(backup, "product.original.json"), plan.productBytes, plan.productHash);

    const journal = {
      schema: 1,
      appRoot: this.appRoot,
      backup,
      targets: plan.targets.map((target) => ({
        file: target.path,
        backupFile: target.backup,
        originalHash: target.originalHash,
        patchedHash: target.patchedHash,
      })),
      productHash: plan.productHash,
      patchedProductHash: plan.patchedProductHash,
      state: "prepared",
    };
    await fs.mkdir(this.storagePath, { recursive: true });
    const journalPath = path.join(this.storagePath, "compatibility.json");
    await atomicWrite(journalPath, Buffer.from(JSON.stringify(journal, null, 2)));

    try {
      for (const target of plan.targets) {
        await atomicWrite(target.path, Buffer.from(target.patched));
        if (digest(await fs.readFile(target.path)) !== target.patchedHash) {
          throw new Error("Cursor Workbench verification failed after patch.");
        }
      }
      if (plan.patchedProductHash !== plan.productHash) {
        await atomicWrite(this.productPath, plan.patchedProduct);
      }
      if (digest(await fs.readFile(this.productPath)) !== plan.patchedProductHash) {
        throw new Error("Cursor product.json verification failed after patch.");
      }
      journal.state = "installed";
      await atomicWrite(journalPath, Buffer.from(JSON.stringify(journal, null, 2)));
    } catch (error) {
      await this.restoreFromJournal(journal).catch(() => undefined);
      journal.state = "install_failed";
      await atomicWrite(journalPath, Buffer.from(JSON.stringify(journal, null, 2)));
      throw error;
    }
  }

  async restore(): Promise<boolean> {
    const journalPath = path.join(this.storagePath, "compatibility.json");
    const journal = JSON.parse(await fs.readFile(journalPath, "utf8")) as {
      appRoot: string;
      backup: string;
      targets: Array<{ file: string; backupFile: string; originalHash: string; patchedHash: string }>;
      productHash: string;
      patchedProductHash: string;
      state: string;
    };
    if (path.resolve(journal.appRoot) !== this.appRoot) {
      throw new Error("The compatibility backup belongs to a different Cursor installation.");
    }
    await this.restoreFromJournal(journal);
    journal.state = "restored";
    await atomicWrite(journalPath, Buffer.from(JSON.stringify(journal, null, 2)));
    return true;
  }

  private async restoreFromJournal(journal: {
    backup: string;
    targets: Array<{ file: string; backupFile: string; originalHash: string; patchedHash: string }>;
    productHash: string;
    patchedProductHash: string;
  }): Promise<void> {
    for (const target of journal.targets) {
      const current = await fs.readFile(target.file);
      const currentHash = digest(current);
      if (currentHash === target.originalHash) continue;
      if (currentHash !== target.patchedHash) {
        throw new Error("Cursor Workbench changed after installation; refusing to overwrite unknown changes.");
      }
      const original = await fs.readFile(path.join(journal.backup, target.backupFile));
      if (digest(original) !== target.originalHash) throw new Error("Original Workbench backup hash mismatch.");
      await atomicWrite(target.file, original);
    }

    const currentProduct = await fs.readFile(this.productPath);
    const currentProductHash = digest(currentProduct);
    if (currentProductHash !== journal.productHash) {
      if (currentProductHash !== journal.patchedProductHash) {
        throw new Error("Cursor product.json changed after installation; refusing to overwrite unknown changes.");
      }
      const original = await fs.readFile(path.join(journal.backup, "product.original.json"));
      if (digest(original) !== journal.productHash) throw new Error("Original product.json backup hash mismatch.");
      await atomicWrite(this.productPath, original);
    }
  }

  private isDailyCursorApp(): boolean {
    if (process.platform === "win32") {
      // Require explicit consent for every real Windows resources/app install, including custom drives.
      return /[\\/]resources[\\/]app$/i.test(this.appRoot) &&
        !/[\\/]Cursor-Antigravity-Test[\\/]/i.test(this.appRoot);
    }
    return this.appRoot === path.resolve("/Applications/Cursor.app/Contents/Resources/app");
  }
}

function pathExistsSync(file: string): boolean {
  try {
    return requireExists(file);
  } catch {
    return false;
  }
}

function requireExists(file: string): boolean {
  // fs.access is asynchronous; use a tiny synchronous stat via node:fs for constructor filtering.
  return existsSync(file);
}

import { existsSync } from "node:fs";

async function writeBackup(file: string, bytes: Buffer, expectedHash: string): Promise<void> {
  await fs.writeFile(file, bytes, { flag: "wx", mode: 0o600 }).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
    if (digest(await fs.readFile(file)) !== expectedHash) throw new Error("Existing Cursor backup does not match the original hash.");
  });
}
