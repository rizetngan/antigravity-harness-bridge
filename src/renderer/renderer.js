/* Antigravity Cursor renderer adapter. No account credentials are stored here. */
(function installAntigravityBridge(config) {
  'use strict';
  const prefix = 'antigravity/';
  let catalogue, catalogueAt = 0;
  const active = new Set();
  const json = value => value?.toJson ? value.toJson({ emitDefaultValues: false }) : value;
  function trace(event, data = {}) {
    try {
      const records = globalThis.__antigravityBridgeDiagnostics ||= [];
      if (event !== 'model picker merged') {
        records.push({ event, data, at: Date.now() });
        if (records.length > 300) records.shift();
      }
      console.info('[antigravity-cursor]', event, data);
    } catch {}
  }

  function runRequestOf(value) {
    if (value?.runRequest) return value.runRequest;
    if (value?.message?.case === 'runRequest') return value.message.value;
    if (value?.message?.runRequest) return value.message.runRequest;
    return undefined;
  }
  function modelIds(run) {
    return [
      run?.requestedModel?.modelId,
      run?.modelDetails?.modelId,
      run?.modelDetails?.displayModelId,
      run?.requestedModel?.displayModelId,
      run?.requestedModel?.serverModelName,
    ].filter(value => typeof value === 'string' && value.length > 0);
  }
  function isCustom(value) {
    const run = runRequestOf(value);
    return modelIds(run).some(id => id.startsWith(prefix));
  }
  function resolveModelSelection(modelId, models = []) {
    let raw = String(modelId || '').trim();
    if (raw.startsWith(prefix)) raw = raw.slice(prefix.length);
    const bracket = /^(.*)\[([^\]]+)\]$/.exec(raw);
    const parsedParameters = [];
    if (bracket) {
      raw = bracket[1];
      for (const pair of bracket[2].split(',')) {
        const split = pair.indexOf('=');
        if (split > 0) parsedParameters.push({ id: pair.slice(0, split).trim(), value: pair.slice(split + 1).trim() });
      }
    }
    for (const model of models) {
      const variant = (model.variants || []).find(item => item.id === raw);
      if (variant) return { model, variant, parameters: parsedParameters };
      if (model.id === raw) return {
        model, variant: { id: model.id, label: '', thinking: false, agentic: false }, parameters: parsedParameters,
      };
    }
    const suffixes = [
      ['-thinking-agentic', { thinking: true, agentic: true }],
      ['-agentic', { thinking: false, agentic: true }],
      ['-thinking', { thinking: true, agentic: false }],
    ];
    for (const [suffix, flags] of suffixes) if (raw.endsWith(suffix)) {
      return { model: { id: raw.slice(0, -suffix.length), name: raw.slice(0, -suffix.length) },
        variant: { id: raw, label: '', ...flags }, parameters: parsedParameters };
    }
    return { model: { id: raw, name: raw }, variant: { id: raw, label: '', thinking: false, agentic: false }, parameters: parsedParameters };
  }
  function sanitizeParameters(parameters, fallback = []) {
    const source = Array.isArray(parameters) && parameters.length ? parameters : fallback;
    return source.filter(item => item && typeof item.id === 'string' &&
      ['string', 'number', 'boolean'].includes(typeof item.value))
      .map(item => ({ id: item.id, value: item.value }));
  }
  // Accepts both JSON ({ model | inherit | disabled }) and message ({ selection: { case, value } }) shapes.
  function sanitizeOverride(item) {
    const subagentType = typeof item?.subagentType === 'string' ? item.subagentType : '';
    if (!subagentType) return undefined;
    const selection = item.selection?.case ? item.selection : item.model ? { case: 'model', value: item.model }
      : item.inherit ? { case: 'inherit' } : item.disabled ? { case: 'disabled' } : undefined;
    if (selection?.case === 'inherit') return { subagentType, inherit: true };
    if (selection?.case === 'disabled') return { subagentType, disabled: true };
    if (selection?.case === 'model' && typeof selection.value?.modelId === 'string') {
      return { subagentType, model: { modelId: selection.value.modelId, parameters: sanitizeParameters(selection.value.parameters) } };
    }
    return undefined;
  }
  function sanitizeRun(value, models = []) {
    const run = runRequestOf(value);
    if (!run) return value;
    const candidates = modelIds(run);
    const bridgeId = candidates.find(id => id.startsWith(prefix));
    const selection = bridgeId ? resolveModelSelection(bridgeId, models) : undefined;
    const requested = run.requestedModel || {};
    const modelId = bridgeId || candidates[0] || '';
    const normalizedId = selection ? prefix + selection.variant.id : modelId;
    const parameters = sanitizeParameters(requested.parameters, selection?.parameters || []);
    const displayName = selection
      ? 'Antigravity · ' + prettyModelName(selection.model) + (selection.variant.label ? ' ' + selection.variant.label : '')
      : (run.modelDetails?.displayName || 'Antigravity');
    const modelDetails = {
      modelId: normalizedId,
      displayModelId: normalizedId,
      displayName,
      displayNameShort: displayName,
      ...(selection?.variant.thinking ? { thinkingDetails: {} } : {}),
      ...(typeof run.modelDetails?.maxMode === 'boolean' ? { maxMode: run.modelDetails.maxMode } : {}),
    };
    const first = {
      runRequest: {
        action: run.action, conversationId: run.conversationId, conversationState: run.conversationState,
        customSystemPrompt: run.customSystemPrompt, mcpTools: run.mcpTools,
        ...(run.subagentTypeName ? { subagentTypeName: run.subagentTypeName } : {}),
        // Cursor's native "Task Models" setting (per subagent type). Only plain fields are kept.
        ...(Array.isArray(run.subagentModelOverrides) && run.subagentModelOverrides.length
          ? { subagentModelOverrides: run.subagentModelOverrides.map(sanitizeOverride).filter(Boolean) } : {}),
        preFetchedBlobs: run.preFetchedBlobs,
        requestedModel: {
          modelId: normalizedId,
          ...(typeof requested.maxMode === 'boolean' ? { maxMode: requested.maxMode } : {}),
          ...(parameters.length ? { parameters } : {}),
          ...(typeof requested.builtInModel === 'boolean' ? { builtInModel: requested.builtInModel } : {}),
        },
        modelDetails,
      },
    };
    if (selection) {
      first.modelMetadata = {
        id: selection.model.id,
        name: selection.model.name,
        contextWindow: selection.model.contextWindow,
        additionalModelRequestFieldsSchema: selection.model.additionalModelRequestFieldsSchema,
        reasoning: selection.model.reasoning,
        variant: selection.variant,
      };
    }
    return first;
  }

  async function call(endpoint, body, signal) {
    const response = await fetch(config.url + endpoint, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: 'Bearer ' + config.token, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal,
    });
    if (!response.ok) {
      let detail = '';
      try { detail = (await response.json()).error || ''; } catch {}
      throw new Error(detail || 'Antigravity for Cursor 本机中转不可用（HTTP ' + response.status + '）。');
    }
    return response;
  }
  async function getCatalogue() {
    if (catalogue && Date.now() - catalogueAt < 2000) return catalogue;
    const response = await call('/catalog', undefined, AbortSignal.timeout(2500));
    catalogue = await response.json(); catalogueAt = Date.now(); return catalogue;
  }
  function combined(buffered, iterator) {
    return { async *[Symbol.asyncIterator]() {
      for (const value of buffered) yield value;
      for (;;) { const next = await iterator.next(); if (next.done) return; yield next.value; }
    } };
  }
  async function* ndjson(response) {
    const reader = response.body.getReader(), decoder = new TextDecoder(); let buffered = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        buffered += decoder.decode(value, { stream: !done });
        if (buffered.length > 20 * 1024 * 1024) throw new Error('Antigravity for Cursor 响应超过限制。');
        let newline;
        while ((newline = buffered.indexOf('\n')) >= 0) {
          const line = buffered.slice(0, newline); buffered = buffered.slice(newline + 1);
          if (line.trim()) yield JSON.parse(line);
        }
        if (done) break;
      }
      if (buffered.trim()) yield JSON.parse(buffered);
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  async function* nativeRun(original, service, input, options = {}) {
    trace('AgentService.run invoked', { asyncIterable: typeof input?.[Symbol.asyncIterator] === 'function' });
    const iterator = input[Symbol.asyncIterator]();
    const buffered = [];
    let initial;
    for (;;) {
      const next = await iterator.next();
      if (next.done) { yield* original(combined(buffered, iterator), options); return; }
      const value = json(next.value);
      const request = runRequestOf(value);
      if (request) trace('AgentService.run request item', { keys: Object.keys(value || {}), modelIds: modelIds(request), custom: isCustom(value) });
      if (!request) { buffered.push(next.value); continue; }
      if (!isCustom(value)) { trace('AgentService.run passthrough', { reason: 'non_antigravity_model', modelIds: modelIds(request) }); yield* original(combined([...buffered, next.value], iterator), options); return; }
      initial = value;
      break;
    }

    const catalog = await getCatalogue().catch(() => ({ models: [] }));
    const first = sanitizeRun(initial, catalog.models || []);
    const id = crypto.randomUUID(), controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) abort(); else options.signal?.addEventListener('abort', abort, { once: true });
    active.add(controller);
    let pump, checkpointState;
    const kvWaiters = new Map(); let nextKvId = 1000000;
    const base64 = bytes => { let text = ''; for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(text); };
    async function* storeBlob(type, value) {
      const Type = globalThis.__antigravityBridge.nativeType(type);
      const bytes = Type.fromJson(value, { ignoreUnknownFields: false }).toBinary();
      const blobId = base64(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))), id = nextKvId++;
      let timer, onAbort;
      const ack = new Promise((resolve, reject) => {
        kvWaiters.set(id, { resolve, reject });
        timer = setTimeout(() => { kvWaiters.delete(id); reject(new Error('等待 Cursor 保存会话超时。')); }, 30000);
        onAbort = () => reject(controller.signal.reason || new Error('会话已取消。'));
        controller.signal.addEventListener('abort', onAbort, { once: true });
      });
      ack.catch(() => {});
      try {
        yield service.methods.run.O.fromJson({ kvServerMessage: { id, setBlobArgs: { blobId, blobData: base64(bytes) } } });
        const result = await ack;
        if (result?.error) throw new Error('Cursor 无法保存原生会话数据。');
        return blobId;
      } finally { clearTimeout(timer); kvWaiters.delete(id); controller.signal.removeEventListener('abort', onAbort); }
    }
    async function* checkpoint(data) {
      const user = yield* storeBlob('UserMessage', data.userMessage);
      const steps = [];
      for (const step of data.steps) steps.push(yield* storeBlob('ConversationStep', step));
      const turn = yield* storeBlob('ConversationTurnStructure', { agentConversationTurn: {
        userMessage: user, steps, userMessageId: data.userMessage.messageId,
        requestId: id, routedModelDisplayName: data.modelName,
        assistantTextStepIndices: data.steps.map((step, i) => step.assistantMessage ? i : -1).filter(i => i >= 0), assistantTextStepsRecorded: true,
      } });
      const previous = checkpointState || data.state || {};
      checkpointState = { ...previous, turns: [...previous.turns || [], turn], mode: data.mode };
      yield service.methods.run.O.fromJson({ conversationCheckpointUpdate: checkpointState }, { ignoreUnknownFields: false });
    }
    try {
      const response = await call('/sessions/' + id + '/start', { first }, controller.signal);
      options.onHeader?.(new Headers());
      // Cursor may send a prewarm request or heartbeat before its actual runRequest.
      // Preserve those messages for the local session instead of bypassing the bridge.
      for (const message of buffered) {
        await call('/sessions/' + id + '/input', { message: json(message) }, controller.signal);
      }
      pump = (async () => {
        for (;;) {
          const item = await iterator.next();
          if (item.done || controller.signal.aborted) return;
          const value = json(item.value);
          if (value.kvClientMessage && kvWaiters.has(value.kvClientMessage.id)) {
            kvWaiters.get(value.kvClientMessage.id).resolve(value.kvClientMessage.setBlobResult); continue;
          }
          await call('/sessions/' + id + '/input', { message: value }, controller.signal);
        }
      })();
      pump.catch(error => { if (!controller.signal.aborted) controller.abort(error); });
      let finished = false;
      for await (const item of ndjson(response)) {
        if (item.error) throw new Error(item.error);
        if (item.done) { finished = true; break; }
        if (item.checkpoint) { yield* checkpoint(item.checkpoint); continue; }
        if (item.message) yield service.methods.run.O.fromJson(item.message, { ignoreUnknownFields: false });
      }
      if (!finished && !controller.signal.aborted) throw new Error('Antigravity for Cursor 会话提前结束，请重试。');
      options.onTrailer?.(new Headers());
    } finally {
      controller.abort(); active.delete(controller); options.signal?.removeEventListener('abort', abort);
      for (const waiter of kvWaiters.values()) waiter.reject(new Error('会话已取消。'));
      iterator.return?.().catch?.(() => {});
      void call('/sessions/' + id + '/cancel', {}, AbortSignal.timeout(2000)).catch(() => {});
      pump?.catch(() => {});
    }
  }

  // Antigravity often reports raw IDs such as "claude-opus-5.5" as the model name.
  function prettyModelName(model) {
    const raw = String(model?.name || model?.id || '').trim();
    if (!raw) return 'Antigravity';
    if (/\s/.test(raw) || raw !== raw.toLowerCase()) return raw;
    return raw.split(/[-_]+/).filter(Boolean).map(part => {
      if (/^(gpt|glm|oss|llm)$/.test(part)) return part.toUpperCase();
      if (/^\d/.test(part)) return part;
      return part[0].toUpperCase() + part.slice(1);
    }).join(' ');
  }
  function effortDisplayName(value) {
    return ({ minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' })[value] || value;
  }
  function modelEntries(models, agent = false) {
    const entries = [];
    for (const model of models) {
      const variants = Array.isArray(model.variants) && model.variants.length
        ? model.variants : [{ id: model.id, label: '', thinking: false, agentic: false }];
      for (const variant of variants) {
        const id = prefix + variant.id;
        // Cursor shows variant.displayName in the picker and displayNameOutsidePicker in the
        // input box. Both must carry the model name; the effort label alone reads as a model.
        const shortName = prettyModelName(model) + (variant.label ? ' ' + variant.label : '');
        const displayName = 'Antigravity · ' + shortName;
        if (agent) {
          entries.push({
            modelId: id, displayModelId: id, displayName, displayNameShort: displayName,
            ...(variant.thinking ? { thinkingDetails: {} } : {}),
          });
          continue;
        }
        const effortValues = variant.thinking ? (model.reasoning?.effortValues || []) : [];
        const defaultEffort = model.reasoning?.defaultEffort || effortValues[0];
        const parameterDefinitions = effortValues.length ? [{
          id: 'reasoning_effort',
          name: 'Thinking depth',
          markdownTooltip: 'Controls the reasoning depth sent to Antigravity. Only levels supported by this model are shown.',
          parameterType: { enumParameter: { values: effortValues.map(value => ({ value, displayName: effortDisplayName(value) })) } },
          isCycleableByHotkey: true,
        }] : [];
        const modelVariants = effortValues.length ? effortValues.map(value => ({
          displayName: displayName + ' · ' + effortDisplayName(value),
          displayNameOutsidePicker: shortName + ' · ' + effortDisplayName(value),
          parameterValues: [{ id: 'reasoning_effort', value }],
          isMaxMode: false,
          isDefaultNonMaxConfig: value === defaultEffort,
          variantStringRepresentation: id + '[reasoning_effort=' + value + ']',
          legacySlug: id + '-' + value,
        })) : [{
          displayName, displayNameOutsidePicker: shortName,
          parameterValues: [], isMaxMode: false, isDefaultNonMaxConfig: true,
          variantStringRepresentation: id + '[]', legacySlug: id,
        }];
        entries.push({
          name: id, serverModelName: id, clientDisplayName: displayName,
          inputboxShortModelName: shortName, defaultOn: true,
          supportsAgent: true, supportsNonMaxMode: true, supportsMaxMode: false,
          supportsImages: false,
          supportsThinking: Boolean(variant.thinking), supportsAutoContext: true,
          ...(Number.isFinite(model.contextWindow) ? { contextTokenLimit: model.contextWindow } : {}),
          supportsPlanMode: model.supportsPlanMode !== false,
          supportsCmdK: false, vendorName: 'Antigravity',
          namedModelSectionIndex: entries.length + 1,
          parameterDefinitions, variants: modelVariants,
          legacySlugs: [], idAliases: [],
        });
      }
    }
    return entries;
  }
  function availableModelNames(entries) {
    const names = [];
    for (const entry of entries) {
      if (entry.name) names.push(entry.name);
      for (const variant of entry.variants || []) {
        if (variant.variantStringRepresentation) names.push(variant.variantStringRepresentation);
        if (variant.legacySlug) names.push(variant.legacySlug);
      }
    }
    return [...new Set(names)];
  }
  function modelResponse(service, method, models) {
    const agent = service.typeName === 'agent.v1.AgentService';
    const entries = modelEntries(models, agent);
    return service.methods[method].O.fromJson({
      models: entries,
      ...(agent ? {} : {
        // Cursor's fixUnavailable validates the persisted parameterized model ID against
        // AvailableModelsResponse.modelNames, not only against models[].variants.
        modelNames: availableModelNames(entries),
        useModelParameters: entries.some(model => Array.isArray(model.parameterDefinitions) && model.parameterDefinitions.length > 0),
      }),
    }, { ignoreUnknownFields: true });
  }
  const catalogueStorageKey = 'antigravity-cursor.catalogue.v1.' + config.url;
  function loadCachedModels() {
    try {
      const stored = JSON.parse(globalThis.localStorage?.getItem(catalogueStorageKey) || 'null');
      if (!stored || !Array.isArray(stored.models) || stored.models.length > 200) return [];
      return stored.models.filter(m => typeof m?.id === 'string' && /^[a-zA-Z0-9._-]+$/.test(m.id) &&
        typeof m.name === 'string' && Array.isArray(m.variants));
    } catch { return []; }
  }
  let cachedModels = loadCachedModels();
  let pickerModels = modelEntries(cachedModels), pickerSignature = JSON.stringify(modelEntries(cachedModels)), modelService, stopped = false, catalogueTimer;
  let catalogueStatus = 'connecting';
  function registeredModel(id, isBlocked) {
    // This predicate only describes our local provider's known model definitions.
    // It never overrides the native blocked-model policy or authorizes an ACP request.
    if (typeof id !== 'string' || !id.startsWith(prefix) || isBlocked?.(id)) return false;
    const matching = pickerModels.find(m => availableModelNames([m]).includes(id));
    return Boolean(matching && !isBlocked?.(matching.name));
  }
  function updatePicker(entries, revision) {
    const signature = JSON.stringify(entries) + '#' + (Number(revision) || 0);
    if (signature === pickerSignature) return;
    pickerModels = entries;
    pickerSignature = signature;
    modelService?.reactiveStorageService?.bumpAvailableModelsCatalogRevision?.();
  }
  function updateCatalogueStatus(status) {
    if (status === catalogueStatus) return;
    catalogueStatus = status;
    trace('catalogue status changed', { status, modelCount: cachedModels.length });
  }
  async function syncPicker() {
    try {
      const value = await getCatalogue();
      if (value.enabled !== true || !Array.isArray(value.models)) throw new Error('Antigravity catalogue unavailable.');
      cachedModels = value.models;
      try { globalThis.localStorage?.setItem(catalogueStorageKey, JSON.stringify({models:cachedModels})); } catch {}
      updatePicker(modelEntries(cachedModels), value.revision);
      updateCatalogueStatus('connected');
    } catch {
      // A model's name and parameter metadata are stable. Native Cursor memoizes
      // these entries, so connection status must not become part of a model label.
      // Retain the last catalogue for selection; all runs still require a live gateway.
      updateCatalogueStatus('unavailable');
    } finally {
      if (!stopped) catalogueTimer = setTimeout(syncPicker, 2000);
    }
  }
  // The managed Agent Host bypasses the renderer RPC factory. Route only explicitly
  // selected Antigravity turns at the per-turn execution strategy, keeping Cursor's
  // default execution strategy untouched for every other model.
  function isBridgeTurn(turn) {
    return modelIds({ requestedModel: turn?.runOptions?.requestedModel,
      modelDetails: turn?.modelDetails }).some(id => id.startsWith(prefix));
  }
  const jsonNative = value => value?.toJson ? value.toJson({ emitDefaultValues: false, enumAsInteger: true }) : value;
  // Read only the current turn's native blob-store interface. Cursor owns the
  // encryption and access checks; no database keys or private thought text leave it.
  async function readVisibleHistory(turn) {
    const refs = turn.conversationState?.turns || [];
    if (!Array.isArray(refs)) throw new Error('Antigravity: invalid Cursor history.');
    const entries = [];
    const selected = refs.slice(-24);
    if (selected.length && typeof turn.blobStore?.getBlob !== 'function') {
      throw new Error('Antigravity: native conversation history is unavailable.');
    }
    const bytesOf = ref => {
      if (typeof ref !== 'string') return ref;
      return Uint8Array.from(atob(ref.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    };
    async function read(type, ref) {
      if (!ref) throw new Error('Antigravity: a native history reference is missing.');
      const bytes = await turn.blobStore.getBlob(turn.ctx, bytesOf(ref));
      if (!bytes) throw new Error('Antigravity: a native history blob is unavailable.');
      return jsonNative(globalThis.__antigravityBridge.nativeType(type).fromBinary(bytes));
    }
    const shorten = value => typeof value === 'string' ? value.slice(0, 6000) : '';
    for (const ref of selected) {
      const native = await read('ConversationTurnStructure', ref);
      const agent = native.agentConversationTurn;
      if (!agent) continue; // Non-agent turns are not sent as conversational instructions.
      const user = await read('UserMessage', agent.userMessage);
      entries.push({ role: 'user', text: shorten(user.text), imageCount: Array.isArray(user.images) ? user.images.length : 0 });
      const text = [], tools = [];
      for (const stepRef of agent.steps || []) {
        const step = await read('ConversationStep', stepRef);
        if (typeof step.assistantMessage?.text === 'string') text.push(step.assistantMessage.text);
        if (step.toolCall) {
          const key = Object.keys(step.toolCall).find(k => /ToolCall$/.test(k));
          if (key) tools.push({ name: key, status: 'recorded' });
        }
      }
      entries.push({ role: 'assistant', text: shorten(text.join('\n')), toolResults: tools.slice(0, 30) });
    }
    return { source: 'native-turns', totalTurns: refs.length, entries };
  }
  async function executeBridgeTurn(turn) {
    const run = {
      conversationId: turn.conversationId,
      action: jsonNative(turn.action),
      conversationState: jsonNative(turn.conversationState),
      requestedModel: jsonNative(turn.runOptions?.requestedModel),
      modelDetails: jsonNative(turn.modelDetails),
      customSystemPrompt: turn.runOptions?.customSystemPrompt,
    };
    if (!run.action?.userMessageAction?.userMessage) {
      throw new Error('Antigravity currently supports new user-message turns only. Send a new message to continue.');
    }
    if (!turn.blobStore?.setBlob || !turn.checkpointHandler?.handleCheckpoint || !turn.interactionListener?.sendUpdate) {
      throw new Error('Antigravity: incompatible Cursor turn callbacks.');
    }
    const id = crypto.randomUUID(), controller = new AbortController();
    const signal = turn.abortController?.signal || turn.ctx?.signal;
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    active.add(controller);
    let checkpointState = run.conversationState || {}, completed = false, hasCheckpoint = false;
    const base64 = bytes => { let text = ''; for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(text); };
    async function store(type, value) {
      const bytes = globalThis.__antigravityBridge.nativeType(type).fromJson(value, { ignoreUnknownFields: false }).toBinary();
      const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      await turn.blobStore.setBlob(turn.ctx, hash, bytes);
      return base64(hash);
    }
    try {
      const Type = globalThis.__antigravityBridge.nativeType('AgentServerMessage');
      const catalog = await getCatalogue();
      const history = await readVisibleHistory(turn);
      const first = sanitizeRun({ runRequest: run }, catalog.models || []);
      const user = run.action.userMessageAction.userMessage;
      first.runRequest.action = { userMessageAction: { userMessage: {
        text: user.text, messageId: user.messageId, mode: user.mode,
      } } };
      // The server receives the visible transcript, not native root/system/blob references.
      first.runRequest.conversationState = { mode: run.conversationState?.mode, turns: [] };
      const selectedId = first.runRequest.requestedModel.modelId.slice(prefix.length);
      if (!first.runRequest.requestedModel.modelId.startsWith(prefix) ||
          !catalog.models?.some(model => model.id === selectedId || model.variants?.some(variant => variant.id === selectedId))) {
        throw new Error('Antigravity model is not available in the current account catalogue.');
      }
      trace('ACP strategy turn', { modelId: first.runRequest.requestedModel.modelId });
      turn.runOptions?.onNetworkPhaseStart?.();
      const response = await call('/sessions/' + id + '/start', { first, history }, controller.signal);
      turn.runOptions?.onHeader?.(new Headers());
      for await (const item of ndjson(response)) {
        if (item.error) throw new Error(item.error);
        if (item.done) { completed = true; break; }
        if (item.message) {
          const message = Type.fromJson(item.message, { ignoreUnknownFields: false }).message;
          if (message.case === 'interactionUpdate') await turn.interactionListener.sendUpdate(turn.ctx, message.value);
          else throw new Error('Unsupported Antigravity interaction event: ' + message.case);
        }
        if (item.checkpoint) {
          const data = item.checkpoint;
          const user = await store('UserMessage', { ...run.action.userMessageAction.userMessage, ...data.userMessage });
          const steps = [];
          for (const step of data.steps) steps.push(await store('ConversationStep', step));
          const turnId = await store('ConversationTurnStructure', { agentConversationTurn: {
            userMessage: user, steps, userMessageId: data.userMessage.messageId,
            requestId: id, routedModelDisplayName: data.modelName,
            assistantTextStepIndices: data.steps.map((step, i) => step.assistantMessage ? i : -1).filter(i => i >= 0), assistantTextStepsRecorded: true,
          } });
          checkpointState = { ...checkpointState, turns: [...checkpointState.turns || [], turnId], mode: data.mode };
          const state = Type.fromJson({ conversationCheckpointUpdate: checkpointState }, { ignoreUnknownFields: false }).message;
          if (state.case !== 'conversationCheckpointUpdate') throw new Error('Invalid Cursor checkpoint event.');
          await turn.blobStore.flush?.(turn.ctx);
          await turn.checkpointHandler.handleCheckpoint(turn.ctx, state.value);
          hasCheckpoint = true;
        }
      }
      if (!completed || !hasCheckpoint) throw new Error('Antigravity turn ended before a complete checkpoint.');
      trace('ACP strategy turn completed', { modelId: first.runRequest.requestedModel.modelId });
    } finally {
      controller.abort(); active.delete(controller); signal?.removeEventListener('abort', abort);
      void call('/sessions/' + id + '/cancel', {}, AbortSignal.timeout(2000)).catch(() => {});
    }
  }
  globalThis.__antigravityBridge = {
    version: 16,
    catalogueStatus: () => catalogueStatus,
    registeredModel,
    wrapExecutionStrategy(original) {
      return {
        executeTurn(turn) { return isBridgeTurn(turn) ? executeBridgeTurn(turn) : original.executeTurn(turn); },
        dispose() { return original.dispose?.(); },
      };
    },
    mergeModels(service, base) {
      modelService = service;
      // Track the native reactive revision even when Cursor uses its private
      // inference catalogue, whose computation may otherwise skip this dependency.
      service?.reactiveStorageService?.availableModelsCatalogRevision?.();
      trace('model picker merged', { baseCount: base.length, antigravityCount: pickerModels.length });
      // Cursor switches its private-inference catalog from "off" to "loading"
      // during startup. That state must not suppress this independent Antigravity catalog.
      const models = base.filter(model => !model.name?.startsWith(prefix));
      return models.concat(pickerModels);
    },
    wrapClient(client, service) {
      if (!['agent.v1.AgentService', 'aiserver.v1.AiService'].includes(service.typeName)) return client;
      trace('RPC client wrapped', { service: service.typeName, methods: Object.keys(service.methods || {}).filter(name => ['run', 'runSSE', 'runPoll', 'getUsableModels', 'availableModels', 'streamComposer', 'streamChatTryReallyHard'].includes(name)) });
      return new Proxy(client, { get(target, name) {
        const original = target[name];
        if (['run', 'runSSE', 'runPoll', 'getUsableModels', 'availableModels', 'streamComposer', 'streamChatTryReallyHard'].includes(name)) {
          trace('RPC method accessed', { service: service.typeName, method: String(name) });
        }
        if (name === 'run' && service.typeName === 'agent.v1.AgentService') {
          return (input, options) => { trace('RPC method invoked', { service: service.typeName, method: 'run' }); return nativeRun(original, service, input, options); };
        }
        if (['availableModels', 'getUsableModels'].includes(name) && typeof original === 'function') {
          return async (...args) => {
            trace('model lookup invoked', { service: service.typeName, method: String(name), requestKeys: Object.keys(args[0] || {}), requestedCustomModelCount: Array.isArray(args[0]?.customModelIds) ? args[0].customModelIds.length : 0 });
            let catalog;
            try { catalog = await getCatalogue(); } catch { return original(...args); }
            if (!catalog.enabled || !catalog.models?.length) return original(...args);
            const custom = modelResponse(service, name, catalog.models);
            let result;
            try { result = await original(...args); } catch { return custom; }
            const existing = new Set((result.models || []).map(model => model.name || model.modelId));
            for (const model of custom.models) if (!existing.has(model.name || model.modelId)) result.models.push(model);
            if (service.typeName === 'aiserver.v1.AiService') {
              if (!Array.isArray(result.modelNames)) result.modelNames = [];
              for (const id of custom.modelNames || []) if (!result.modelNames.includes(id)) result.modelNames.push(id);
            }
            if (custom.useModelParameters && service.typeName === 'aiserver.v1.AiService') result.useModelParameters = true;
            trace('model lookup merged', {
              service: service.typeName, method: String(name), totalCount: result.models?.length || 0,
              antigravityCount: custom.models?.length || 0,
              modelNamesCount: result.modelNames?.length || 0,
              antigravityVariantNames: (custom.modelNames || []).filter(id => id.includes('[reasoning_effort=')).length,
            });
            return result;
          };
        }
        if (typeof original === 'function' && ['runSSE', 'runPoll', 'streamComposer', 'streamChatTryReallyHard'].includes(name)) {
          return (...args) => {
            const request = json(args[0]) || {};
            const details = request.modelDetails || request.model_details || {};
            trace('RPC method invoked', {
              service: service.typeName, method: String(name), requestKeys: Object.keys(request),
              modelId: details.modelId || details.displayModelId || details.model_id || '',
              conversationId: request.conversationId || request.conversation_id || '',
            });
            return original.apply(target, args);
          };
        }
        return original;
      } });
    },
    stop() { stopped = true; clearTimeout(catalogueTimer); for (const controller of active) controller.abort(); active.clear(); },
  };
  void syncPicker();
})(__ANTIGRAVITY_BRIDGE_CONFIG__);