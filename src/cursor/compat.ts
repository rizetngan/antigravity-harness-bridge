import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { samePath } from "../platform.ts";

export const START = "/* ANTIGRAVITY_BRIDGE_RUNTIME_START v1 */";
export const END = "/* ANTIGRAVITY_BRIDGE_RUNTIME_END v1 */";
export const EXTENSION_ID = "rizetngan.antigravity-cursor";

const MODEL_GETTER = "getAvailableDefaultModels(){return[...this._availableDefaultModels()]}";
const BRIDGE_GETTER = "getAvailableDefaultModels(){/* ANTIGRAVITY_MODEL_GETTER */return globalThis.__antigravityBridge?globalThis.__antigravityBridge.mergeModels(this,[...this._availableDefaultModels()]):[...this._availableDefaultModels()]}";
const AGENT_HOST_ASSIGN = /this\._agentHostEnabled=[^,;]{1,200},/;
// Locate the native fixUnavailable branch by its structural relations and stable
// properties, never by minified variable names. Require the enclosing stored
// config, the blocked-model predicate and the diagnostic marker to agree.
const MODEL_AVAILABILITY = /if\((?<model>[\w$]+)==="default"\)return (?<stored>[\w$]+);const (?<list>[\w$]+)=\k<model>\.split\(","\)\.map\((?<item>[\w$]+)=>\k<item>\.trim\(\)\)\.filter\((?<filter>[\w$]+)=>\k<filter>\.length>0\),(?<resolved>[\w$]+)=\k<list>\.map\((?<resolveItem>[\w$]+)=>[\w$]+\(\k<resolveItem>,(?<available>[\w$]+),[\w$]+\)\);(?<seam>if\(\k<list>\.length>0&&\k<list>\.every\((?<registeredItem>[\w$]+)=>globalThis\.__antigravityBridge\?\.registeredModel\?\.\(\k<registeredItem>,(?<registeredBlocked>[\w$]+)\)\)\)return \k<stored>;)?(?<guard>if\(!\(\k<resolved>\.length>0&&\k<resolved>\.every\((?<everyItem>[\w$]+)=>\k<available>\.includes\(\k<everyItem>\)\)\)\))\{if\(\k<available>\.length===0\|\|(?<field>[\w$]+)==="background-composer"\)return \k<stored>;/g;
const CONFIG_CONTEXT = /const\{([^{}]{1,900})\}=([\w$]+),([\w$]+)=([\w$]+)\.getStoredModelConfig\(([\w$]+)\);/g;

function availabilityMatches(source: string) {
  const result: Array<{ start: number; insert: number; list: string; stored: string; blocked: string; item: string; patched: boolean }> = [];
  for (const m of source.matchAll(MODEL_AVAILABILITY)) {
    const g = m.groups!;
    const at = m.index!;
    const prefix = source.slice(Math.max(0, at - 1800), at);
    const contexts = [...prefix.matchAll(CONFIG_CONTEXT)].filter(c => c[3] === g.stored && c[5] === g.field);
    if (!contexts.length) continue;
    const c = contexts.at(-1)!, fields = c[1];
    const get = (name: string) => new RegExp("(?:^|,)" + name + ":([\\w$]+)(?=[=,]|$)").exec(fields)?.[1];
    const blocked = get("isModelBlocked");
    if (!blocked || get("availableModels") !== g.available || get("specificModelField") !== g.field || get("modelConfigService") !== c[4]) continue;
    if (g.seam && g.registeredBlocked !== blocked) continue;
    if (!source.slice(at + m[0].length, at + m[0].length + 2600).includes('subkey:"fix_unavailable_model_reset"')) continue;
    result.push({ start: at, insert: at + m[0].indexOf(g.guard), list: g.list, stored: g.stored, blocked, item: g.item, patched: Boolean(g.seam) });
  }
  return result;
}
const GLASS_BASE_LIST = /([\w$]+)=\["anysphere\.cursor-resolver","anysphere\.cursor-always-local",/g;
const GLASS_SEAM_MARK = "/* ANTIGRAVITY_GLASS_EXTENSION */";
const GLASS_SEAM_TEXT = GLASS_SEAM_MARK + JSON.stringify(EXTENSION_ID) + ",";

// The native accessor receives the authority resolved by ComposerExecRouting.
 // Only copy its locality to the existing session options. Never infer locality from path spelling.
const EXEC_ACCESSOR = /createRemoteAccessor\(([\w$]+(?:,[\w$]+){7})\)\{/g;
const EXEC_OPTIONS = /agentHostSessionOptionsBase:\{workspacePaths:([\w$]+)\.workspacePaths,worktreeMainPath:\1\.worktreeMainPath,isGlassRoot:\1\.isGlassRoot,/g;
export function patchExecutionLocality(source: string): string {
  const matches = [...source.matchAll(EXEC_ACCESSOR)];
  if (matches.length !== 1) return source;
  const match = matches[0];
  const authority = match[1].split(",")[7];
  const start = match.index! + match[0].length;
  const section = source.slice(start, start + 18000);
  const options = [...section.matchAll(EXEC_OPTIONS)];
  if (options.length !== 1) return source;
  const at = start + options[0].index! + options[0][0].length;
  return source.slice(0, at) + "/* ANTIGRAVITY_EXEC_LOCALITY */__agLocalExecution:(" + authority + "==null)," + source.slice(at);
}

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
  // Pure synthetic test fixtures do not contain the entire native UI.
  syntheticFixture?: boolean;
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

export function hasBridgeMarkers(source: string): boolean {
  return source.includes(START) || source.includes(END) || source.includes("__antigravityBridge") || /\/\* ANTIGRAVITY_[A-Z_]+ \*\//.test(source);
}

// Runtime revision is diagnostic metadata, never a host version gate.
export function rendererRevision(source: string): number | undefined {
  const end = source.startsWith(START) ? source.indexOf(END) : -1;
  const body = end >= 0 ? source.slice(START.length, end) : source;
  const match = /globalThis\.__antigravityBridge\s*=\s*\{\s*version:\s*(\d+)\b/.exec(body);
  return match ? Number(match[1]) : undefined;
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
  const availability = availabilityMatches(body);
  const modelAvailabilityGuards = availability.filter(match => !match.patched).length;
  const modelAvailabilitySeams = availability.filter(match => match.patched).length;
  const anchors: CompatibilityAnchor[] = [
    { id: "promise_client", count: body.split('"promise-client.js"').length - 1, patched: 0, required: true, ok: false },
    { id: "client_factory", count: factories, patched: wrappedFactories, required: true, ok: false },
    { id: "model_getter", count: getterCount, patched: bridgeGetterCount, required: true, ok: false },
    { id: "turn_strategy", count: [...body.matchAll(STRATEGY)].length, patched: [...body.matchAll(STRATEGY_PATCH)].length, required: false, ok: false },
    ...([...NATIVE_TYPES, ...((body.match(STRATEGY)?.length || body.match(STRATEGY_PATCH)?.length) ? ["AgentServerMessage"] : [])]).map((type) => {
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

// A plan can only be considered native-provider compatible when every seam
// required for the advertised picker/Agent behavior is uniquely present.
const FULL_NATIVE_ANCHORS = new Set(["turn_strategy", "type_AgentServerMessage", "model_availability", "glass_list", "provider_picker", "provider_legacy", "provider_settings", "provider_props"]);

export function nativeCompatibility(source: string): ReturnType<typeof anchorCounts> {
  const result = anchorCounts(source);
  // A retired UI surface need not be patched. An existing but unrecognized
  // surface is still a mismatch; never relax the native turn or picker route.
  const end = result.adapter ? source.indexOf(END) + END.length : 0;
  const body = source.slice(end);
  const retired = new Set<string>();
  if (!body.includes("getAvailableModelsReactiveWithStatus") && !body.includes("_setUseOpenAIKey") && !body.includes(LEGACY_PICKER_MARK)) retired.add("provider_legacy");
  if (!body.includes("getHardcodedLongContextOnlyModelNames") && !body.includes(SETTINGS_PICKER_MARK)) retired.add("provider_settings");
  for (const id of FULL_NATIVE_ANCHORS) {
    if (!result.anchors.some(a => a.id === id)) result.anchors.push({ id, count: 0, patched: 0, required: true, ok: false });
  }
  for (const a of result.anchors) {
    if (FULL_NATIVE_ANCHORS.has(a.id)) {
      a.required = !retired.has(a.id);
      a.ok = a.required ? a.count + a.patched === 1 : a.count + a.patched <= 1;
    }
    if (result.adapter && (a.required && FULL_NATIVE_ANCHORS.has(a.id) || a.id === "model_getter" || a.id === "client_factory") && !a.id.startsWith("type_")) {
      a.ok = a.ok && a.patched === 1 && a.count === 0;
    }
  }
  return { ...result, ok: result.anchors.every(a => a.ok) };
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

  const availability = availabilityMatches(body);
  if (availability.length > 1) throw new Error("Cursor model availability guard is ambiguous.");
  if (availability.length === 1) {
    const a = availability[0];
    if (a.patched) throw new Error("Cursor model availability is already patched.");
    const seam = "if(" + a.list + ".length>0&&" + a.list + ".every(" + a.item + "=>globalThis.__antigravityBridge?.registeredModel?.(" + a.item + "," + a.blocked + ")))return " + a.stored + ";";
    body = body.slice(0, a.insert) + seam + body.slice(a.insert);
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
  body = patchExecutionLocality(body);
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
      result.push({ kind: target.kind, file: target.file, ...(this.options.syntheticFixture ? anchorCounts(source) : nativeCompatibility(source)) });
    }
    return result;
  }

  async runtimeRevisions(): Promise<{ expected?: number; installed: Array<{ kind: string; revision?: number }>; outdated: boolean }> {
    const expected = rendererRevision(await fs.readFile(this.rendererPath, "utf8"));
    const installed = [];
    for (const target of this.targets) {
      const source = await fs.readFile(target.path, "utf8");
      if (source.startsWith(START)) installed.push({ kind: target.kind, revision: rendererRevision(source) });
    }
    return { expected, installed, outdated: expected !== undefined && installed.some(t => t.revision !== expected) };
  }

  // Restoration only needs to know whether our own modifications remain.
  // Do not require a newer, unmodified host to match the current adapter.
  async hasInstalledMarkers(): Promise<boolean> {
    for (const target of this.targets) {
      if (hasBridgeMarkers(await fs.readFile(target.path, "utf8"))) return true;
    }
    return false;
  }

  async plan(config: { url: string; token: string }): Promise<CompatibilityPlan> {
    if (!this.targets.some(target => target.kind === "desktop")) throw new Error("Cursor desktop Workbench is missing.");
    const renderer = await fs.readFile(this.rendererPath, "utf8");
    const targets: CompatibilityTargetPlan[] = [];
    for (const target of this.targets) {
      const source = await fs.readFile(target.path, "utf8");
      const analyze = this.options.syntheticFixture ? anchorCounts : nativeCompatibility;
      const before = analyze(source);
      if (!before.ok || before.adapter) {
        throw new Error(target.file + ": incompatible native seams: " + before.anchors.filter(a => !a.ok).map(a => a.id + "=" + (a.count + a.patched)).join(", "));
      }
      const patched = patchSource(source, renderer, config);
      const after = analyze(patched);
      if (!after.ok || !after.adapter || after.anchors.some(a => FULL_NATIVE_ANCHORS.has(a.id) && a.count === 1 && a.patched !== 1 && !a.id.startsWith("type_"))) {
        throw new Error(target.file + ": generated adapter did not pass native seam verification.");
      }
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

    const backup = path.join(this.storagePath, "backups", digest(JSON.stringify([plan.productHash, ...plan.targets.map(t => [t.key, t.originalHash])])));
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
    let raw: string;
    try { raw = await fs.readFile(journalPath, "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && !(await this.hasInstalledMarkers())) return false;
      throw error;
    }
    const journal = JSON.parse(raw) as {
      appRoot: string;
      backup: string;
      targets: Array<{ file: string; backupFile: string; originalHash: string; patchedHash: string }>;
      productHash: string;
      patchedProductHash: string;
      state: string;
    };
    if (!samePath(journal.appRoot, this.appRoot)) {
      throw new Error("The compatibility backup belongs to a different Cursor installation.");
    }
    const changed = await this.restoreFromJournal(journal);
    if (journal.state !== "restored") {
      journal.state = "restored";
      await atomicWrite(journalPath, Buffer.from(JSON.stringify(journal, null, 2)));
    }
    return changed;
  }

  private async restoreFromJournal(journal: {
    backup: string;
    targets: Array<{ file: string; backupFile: string; originalHash: string; patchedHash: string }>;
    productHash: string;
    patchedProductHash: string;
  }): Promise<boolean> {
    const changes: Array<{ file: string; before: string; bytes: Buffer }> = [];
    const currentTargets: Array<{ key: string; patchedHash: string; originalHash: string; finalHash: string; restore: boolean }> = [];
    // Preflight every affected file before writing any of them. A clean host
    // update is not a conflict; an unknown file still containing our patch is.
    for (const target of journal.targets) {
      const spec = TARGET_SPECS.find(item => samePath(path.join(this.appRoot, "out", "vs", "workbench", item.file), target.file));
      if (!spec || target.backupFile !== spec.backup) throw new Error("Unexpected recovery target.");
      const current = await fs.readFile(target.file).catch(error => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT" && spec.kind !== "desktop") return undefined;
        throw error;
      });
      if (!current) continue; // newer Cursor may no longer ship Glass
      const currentHash = digest(current);
      if (currentHash === target.originalHash || (currentHash !== target.patchedHash && !hasBridgeMarkers(current.toString("utf8")))) {
        currentTargets.push({ key: spec.key, patchedHash: target.patchedHash, originalHash: target.originalHash, finalHash: currentHash, restore: false });
        continue;
      }
      if (currentHash !== target.patchedHash) throw new Error("Cursor Workbench changed with the bridge still present; refusing to overwrite unknown changes.");
      const original = await fs.readFile(path.join(journal.backup, target.backupFile));
      if (digest(original) !== target.originalHash) throw new Error("Original Workbench backup hash mismatch.");
      changes.push({ file: target.file, before: currentHash, bytes: original });
      currentTargets.push({ key: spec.key, patchedHash: target.patchedHash, originalHash: target.originalHash, finalHash: target.originalHash, restore: true });
    }

    const currentProduct = await fs.readFile(this.productPath);
    const currentProductHash = digest(currentProduct);
    if (currentProductHash !== journal.productHash) {
      const product = JSON.parse(currentProduct.toString("utf8")) as { checksums?: Record<string, string> };
      const encodeHash = (hash: string) => Buffer.from(hash, "hex").toString("base64").replace(/=+$/, "");
      const affected = currentTargets.filter(t => t.restore || product.checksums?.[t.key] === encodeHash(t.patchedHash));
      if (affected.length) {
        const original = await fs.readFile(path.join(journal.backup, "product.original.json"));
        if (digest(original) !== journal.productHash) throw new Error("Original product.json backup hash mismatch.");
        const originalProduct = JSON.parse(original.toString("utf8")) as { checksums?: Record<string, string> };
        if (currentProductHash === journal.patchedProductHash && currentTargets.length === journal.targets.length && currentTargets.every(t => t.finalHash === t.originalHash)) {
          changes.push({ file: this.productPath, before: currentProductHash, bytes: original });
        } else {
          let changed = false;
          for (const t of affected) {
            const checksums = product.checksums;
            if (!checksums || !Object.hasOwn(checksums, t.key)) continue;
            const current = checksums[t.key];
            const previous = originalProduct.checksums?.[t.key];
            const patched = encodeHash(t.patchedHash);
            if (t.restore && current !== patched && current !== previous) throw new Error("Cursor checksum changed for a Workbench that still contains the bridge.");
            if (current !== patched) continue;
            if (t.finalHash !== t.originalHash) throw new Error("Changed Workbench still has the old bridge checksum. Complete the Cursor update or repair first.");
            if (previous === undefined) delete checksums[t.key];
            else checksums[t.key] = previous;
            changed = true;
          }
          if (changed) changes.push({ file: this.productPath, before: currentProductHash, bytes: Buffer.from(JSON.stringify(product, null, "\t")) });
        }
      }
    }
    // Recheck only files we will change, to avoid racing the host updater.
    for (const change of changes) {
      if (digest(await fs.readFile(change.file)) !== change.before) throw new Error("Cursor changed during recovery. Retry after the update completes.");
    }
    for (const change of changes) {
      await atomicWrite(change.file, change.bytes);
      if (digest(await fs.readFile(change.file)) !== digest(change.bytes)) throw new Error("Cursor recovery write could not be verified.");
    }
    return changes.length > 0;
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
