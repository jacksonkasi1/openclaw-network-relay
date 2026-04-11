const DEFAULT_ENDPOINT = "http://127.0.0.1:31337/log";
const DEBUGGER_VERSION = "1.3";
const DECISION_TIMEOUT_MS = 20000;

const state = {
  endpoint: DEFAULT_ENDPOINT,
  enabled: false,
  mode: "listen",
  attachedTabId: null,
  rules: [],
  ruleSyncInterval: null,
  ruleSyncInFlight: false,
  commandStream: null,
  reconnectTimer: null
};

function targetForTab(tabId) {
  return { tabId };
}

function isSecureEndpoint(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname));
  } catch {
    return false;
  }
}

function normalizeEndpoint(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || DEFAULT_ENDPOINT;
}


function stripEntityHeaders(headers = []) {
  return headers.filter(h => !/^(content-length|content-encoding|transfer-encoding)$/i.test(h.name));
}

function headerObjectToArray(headers = {}) {
  return Object.entries(headers).map(([name, value]) => ({
    name,
    value: String(value),
  }));
}

function headerArrayToObject(headers = []) {
  const result = {};
  for (const header of headers) {
    if (!header || !header.name) continue;
    const name = header.name.toLowerCase();
    if (result[name]) {
      result[name] = result[name] + ", " + (header.value ?? "");
    } else {
      result[name] = header.value ?? "";
    }
  }
  return result;
}

function encodeUtf8ToBase64(value) {
  if (value === null || value === undefined) return "";
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 8192) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

async function sendCommand(tabId, method, params = {}) {
  return chrome.debugger.sendCommand(targetForTab(tabId), method, params);
}

async function syncRules() {
  if (state.ruleSyncInFlight) return;
  state.ruleSyncInFlight = true;

  if (!isSecureEndpoint(state.endpoint)) {
    state.ruleSyncInFlight = false;
    return;
  }

  try {
    const rulesUrl = new URL(state.endpoint);
    rulesUrl.pathname = '/rules';
    const res = await fetch(rulesUrl.href);
    if (res.ok) {
      const nextRules = await res.json();
      if (Array.isArray(nextRules)) state.rules = nextRules;
    }
  } catch (e) {
  } finally {
    state.ruleSyncInFlight = false;
  }
}


// --- CDP Command Stream ---
function startCommandStream() {
  stopCommandStream();
  // We MUST wait for settings to load properly, and we MUST connect.
  if (!state.enabled || !state.attachedTabId) return;
  // If endpoint is empty, wait for loadSettings to fix it.
  if (!state.endpoint) return;

  try {
    let baseUrlStr = state.endpoint;
    if (baseUrlStr.endsWith('/log')) baseUrlStr = baseUrlStr.replace('/log', '');
    const url = new URL(baseUrlStr);
    url.pathname = '/api/extension/commands';
    
    const controller = new AbortController();
    state.commandStream = controller;

    fetch(url.href, {
      signal: controller.signal,
      headers: { 'Accept': 'text/event-stream' }
    }).then(async response => {
      if (!response.ok) {
        throw new Error("Command stream HTTP error " + response.status);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || ''; // Keep the last incomplete chunk

        for (const chunk of parts) {
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (line.startsWith('data:')) {
              const dataStr = line.slice(5).trim();
              if (!dataStr) continue;

              try {
                const msg = JSON.parse(dataStr);
                if (msg.id && msg.method) {
                  try {
                    const isTabCommand = msg.method === "Target.createTarget" || msg.method === "Target.closeTarget" || msg.method === "Target.activateTarget" || msg.method === "Target.getTabs";

                    if (isTabCommand) {
                      if (msg.method === "Target.createTarget") {
                        const url = typeof msg.params?.url === 'string' ? msg.params.url : 'about:blank';
                        const tab = await chrome.tabs.create({ url, active: false });
                        if (!tab.id) throw new Error('Failed to create tab');
                        await new Promise(r => setTimeout(r, 200));
                        await chrome.debugger.attach({ tabId: tab.id }, DEBUGGER_VERSION).catch(()=>null);
                        await chrome.debugger.sendCommand({ tabId: tab.id }, 'Page.enable').catch(()=>null);
                        await chrome.debugger.sendCommand({ tabId: tab.id }, 'Network.enable').catch(()=>null);
                        await chrome.debugger.sendCommand({ tabId: tab.id }, 'Page.addScriptToEvaluateOnNewDocument', { source: "Object.defineProperty(navigator, 'webdriver', { get: () => false }); window.chrome = window.chrome || {}; window.chrome.runtime = window.chrome.runtime || {};" }).catch(()=>null);
                        const info = await chrome.debugger.sendCommand({ tabId: tab.id }, 'Target.getTargetInfo').catch(()=>null);
                        const targetId = String(info?.targetInfo?.targetId || '').trim();
                        await sendCdpResult(msg.id, { targetId, tabId: tab.id }, null);
                        continue;
                      }
                      if (msg.method === "Target.closeTarget") {
                        const targetTabId = msg.params?.tabId || state.attachedTabId;
                        await chrome.tabs.remove(targetTabId).catch(()=>null);
                        await sendCdpResult(msg.id, { success: true }, null);
                        continue;
                      }
                      if (msg.method === "Target.activateTarget") {
                        const targetTabId = msg.params?.tabId || state.attachedTabId;
                        const tab = await chrome.tabs.get(targetTabId).catch(() => null);
                        if (tab && tab.windowId) {
                          await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
                        }
                        await chrome.tabs.update(targetTabId, { active: true }).catch(() => {});
                        await sendCdpResult(msg.id, { success: true }, null);
                        continue;
                      }
                      if (msg.method === "Target.getTabs") {
                         const allTabs = await chrome.tabs.query({});
                         await sendCdpResult(msg.id, { tabs: allTabs }, null);
                         continue;
                      }
                    }

                    const tabId = msg.params?.tabId || msg.tabId || state.attachedTabId;
                    const result = await chrome.debugger.sendCommand({ tabId }, msg.method, msg.params);
                    await sendCdpResult(msg.id, result, null);
                  } catch (e) {
                    await sendCdpResult(msg.id, null, e.message);
                  }
                }
              } catch (e) {
                console.error("Failed to parse CDP command", e);
              }
            }
          }
        }
      }

      if (state.enabled && state.commandStream === controller) {
        console.error("Command stream disconnected. Reconnecting...");
        state.reconnectTimer = setTimeout(startCommandStream, 3000);
      }
    }).catch(e => {
      if (e.name !== 'AbortError') {
        console.error("Command stream disconnected:", e.message);
        if (state.enabled) {
          state.reconnectTimer = setTimeout(startCommandStream, 3000);
        }
      }
    });

  } catch (e) {
    console.error("Command stream init error:", e.message);
  }
}

function stopCommandStream() {
  if (state.commandStream) {
    state.commandStream.abort(); // Cancel the fetch request
    state.commandStream = null;
  }
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
}

async function sendCdpResult(id, result, error) {
  if (!isSecureEndpoint(state.endpoint)) return;
  try {
    let baseUrlStr = state.endpoint;
    if (baseUrlStr.endsWith('/log')) baseUrlStr = baseUrlStr.replace('/log', '');
    const url = new URL(baseUrlStr);
    url.pathname = '/api/extension/cdp-result';
    await fetch(url.href, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, result, error })
    });
  } catch (e) {}
}

function startRuleSync() {
  if (state.ruleSyncInterval) clearInterval(state.ruleSyncInterval);
  state.ruleSyncInFlight = false;
  void syncRules();
  state.ruleSyncInterval = setInterval(() => { void syncRules(); }, 2000);
}

function stopRuleSync() {
  if (state.ruleSyncInterval) clearInterval(state.ruleSyncInterval);
  state.ruleSyncInterval = null;
  state.ruleSyncInFlight = false;
  state.rules = [];
}

function evaluateRules(payload, phase) {
  if (!state.rules || state.rules.length === 0) return null;
  for (const rule of state.rules) {
    if (rule.phase && rule.phase !== phase && rule.phase !== 'both') continue;
    if (rule.method && rule.method.toUpperCase() !== payload.method.toUpperCase()) continue;
    if (rule.urlPattern && !payload.url.includes(rule.urlPattern)) continue;
    return rule;
  }
  return null;
}

async function persistState() {
  await chrome.storage.local.set({
    webhookUrl: state.endpoint,
    isEnabled: state.enabled,
    mode: state.mode,
    attachedTabId: state.attachedTabId,
  });
}

async function detachFromTab(tabId) {
  if (tabId == null) {
    return;
  }

  try {
    await chrome.debugger.detach(targetForTab(tabId));
  } catch {
    // Ignore detach failures when the tab/debugger is already gone.
  }

  if (state.attachedTabId === tabId) {
    state.attachedTabId = null;
  }
  stopRuleSync();
  stopCommandStream();
}

async function attachToTab(tabId) {
  if (tabId == null) throw new Error("No target tab selected");
  if (state.attachedTabId != null && state.attachedTabId !== tabId) {
    await detachFromTab(state.attachedTabId);
  }
  // Remove the early return so the interval starts even if tabId matches
  
  try {
    await chrome.debugger.attach(targetForTab(tabId), DEBUGGER_VERSION);
  } catch (error) {
    if (!String(error?.message || error).includes("Another debugger is already attached")) {
      throw error;
    }
  }

  await sendCommand(tabId, "Page.enable");
  await sendCommand(tabId, "Network.enable");
  await sendCommand(tabId, "Page.addScriptToEvaluateOnNewDocument", {
    source: "Object.defineProperty(navigator, 'webdriver', { get: () => false }); window.chrome = window.chrome || {}; window.chrome.runtime = window.chrome.runtime || {};"
  });

  await sendCommand(tabId, "Fetch.enable", {
    patterns: [
      { urlPattern: "*", requestStage: "Request" },
      { urlPattern: "*", requestStage: "Response" },
    ],
  });

  state.attachedTabId = tabId;
  startRuleSync();
  startCommandStream();
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(["webhookUrl", "isEnabled", "mode", "attachedTabId"]);

  state.endpoint = normalizeEndpoint(stored.webhookUrl);
  state.enabled = stored.isEnabled === true;
  state.mode = stored.mode === "intercept" ? "intercept" : "listen";
  state.attachedTabId = Number.isInteger(stored.attachedTabId) ? stored.attachedTabId : null;

  if (state.enabled && state.attachedTabId != null) {
    try {
      await chrome.tabs.get(state.attachedTabId);
      await attachToTab(state.attachedTabId);
    } catch {
      state.enabled = false;
      state.attachedTabId = null;
      await persistState();
    }
  }
}

async function getTabLabel(tabId) {
  if (tabId == null) {
    return "No tab attached";
  }

  try {
    const tab = await chrome.tabs.get(tabId);
    return tab.url || tab.title || `Tab ${tabId}`;
  } catch {
    return `Tab ${tabId}`;
  }
}

async function fetchDecision(payload) {
  if (!isSecureEndpoint(state.endpoint)) {
    return { action: "forward" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DECISION_TIMEOUT_MS);

  try {
    const response = await fetch(state.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      return { action: "forward" };
    }

    return await response.json();
  } catch {
    return { action: "forward" };
  } finally {
    clearTimeout(timer);
  }
}

async function continueResponse(tabId, requestId, responseParams = null, responseBodyBase64 = null) {
  try {
    await sendCommand(tabId, "Fetch.continueResponse", { requestId });
  } catch {
    if (responseParams) {
      if (responseParams.responseErrorReason) {
        await sendCommand(tabId, "Fetch.failRequest", {
          requestId,
          errorReason: responseParams.responseErrorReason,
        });
        return;
      }
      await sendCommand(tabId, "Fetch.fulfillRequest", {
        requestId,
        responseCode: responseParams.responseStatusCode || 200,
        responseHeaders: responseParams.responseHeaders || [],
        body: responseBodyBase64 || "",
      });
      return;
    }

    await sendCommand(tabId, "Fetch.continueRequest", { requestId });
  }
}

async function continuePausedRequest(tabId, params, responseBodyBase64 = null) {
  const isResponsePhase = params.responseStatusCode !== undefined || params.responseErrorReason !== undefined;

  if (isResponsePhase) {
    await continueResponse(tabId, params.requestId, params, responseBodyBase64);
    return;
  }

  await sendCommand(tabId, "Fetch.continueRequest", { requestId: params.requestId });
}

function fireAndForgetLog(payload) {
  if (!isSecureEndpoint(state.endpoint)) return;
  fetch(state.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }).catch(() => {});
}

async function handleRequestPause(tabId, params) {
  let requestBody = params.request.postData ?? null;

  // Prevent massive file uploads (multipart/form-data or raw binary streams) from crashing the extension
  // or being corrupted by the Chrome Debugger API when forwarded.
  const contentType = headerArrayToObject(headerObjectToArray(params.request.headers || {}))['content-type'] || '';
  if (contentType.includes('multipart/form-data') || requestBody && requestBody.length > 5000000) {
    requestBody = `[Massive Payload Omitted - Content-Type: ${contentType}]`;
  }

  const payload = {
    id: `${params.requestId}:request`,
    phase: "request",
    mode: state.mode,
    tabId,
    url: params.request.url,
    method: params.request.method,
    resourceType: params.resourceType,
    requestHeaders: params.request.headers || {},
    requestBody: requestBody,
    timestamp: Date.now(),
  };

  const matchedRule = evaluateRules(payload, "request");
  if (matchedRule) {
    payload.appliedRule = matchedRule.name || matchedRule.id;
    fireAndForgetLog(payload);

    if (matchedRule.action === "drop") {
      await sendCommand(tabId, "Fetch.failRequest", { requestId: params.requestId, errorReason: "BlockedByClient" });
      return;
    }
    if (matchedRule.action === "modify") {
      await sendCommand(tabId, "Fetch.continueRequest", {
        requestId: params.requestId,
        url: matchedRule.modifiedUrl,
        method: matchedRule.modifiedMethod,
        postData: matchedRule.modifiedBody != null ? encodeUtf8ToBase64(matchedRule.modifiedBody) : undefined,
        headers: matchedRule.modifiedHeaders ? headerObjectToArray(matchedRule.modifiedHeaders) : undefined,
      });
      return;
    }
    await sendCommand(tabId, "Fetch.continueRequest", { requestId: params.requestId });
    return;
  }

  if (state.mode === "listen") {
    fireAndForgetLog(payload);
    await sendCommand(tabId, "Fetch.continueRequest", { requestId: params.requestId });
    return;
  }

  const decision = await fetchDecision(payload);

  if (decision.action === "drop") {
    await sendCommand(tabId, "Fetch.failRequest", {
      requestId: params.requestId,
      errorReason: "BlockedByClient",
    });
    return;
  }

  if (decision.action === "modify") {
    await sendCommand(tabId, "Fetch.continueRequest", {
      requestId: params.requestId,
      url: decision.modifiedUrl,
      method: decision.modifiedMethod,
      postData: decision.modifiedBody != null ? encodeUtf8ToBase64(decision.modifiedBody) : undefined,
      headers: decision.modifiedHeaders ? headerObjectToArray(decision.modifiedHeaders) : undefined,
    });
    return;
  }

  await sendCommand(tabId, "Fetch.continueRequest", { requestId: params.requestId });
}

async function handleResponsePause(tabId, params) {
  let responseBody = null;
  let responseBodyBase64 = null;
  let responseBodyEncoded = false;

  try {
    const bodyResult = await sendCommand(tabId, "Fetch.getResponseBody", { requestId: params.requestId });
    responseBody = bodyResult.body;
    responseBodyBase64 = bodyResult.base64Encoded ? bodyResult.body : encodeUtf8ToBase64(bodyResult.body);
    responseBodyEncoded = bodyResult.base64Encoded;
    if (bodyResult.base64Encoded) {
      try {
        const binary = atob(bodyResult.body);
        const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
        responseBody = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch(e) { responseBody = bodyResult.body; }
    }
  } catch {
    responseBody = null;
    responseBodyBase64 = null;
  }

  const payload = {
    id: `${params.requestId}:response`,
    phase: "response",
    mode: state.mode,
    tabId,
    url: params.request.url,
    method: params.request.method,
    resourceType: params.resourceType,
    requestHeaders: params.request.headers || {},
    requestBody: params.request.postData ?? null,
    responseStatusCode: params.responseStatusCode,
    responseStatusText: params.responseStatusText || "",
    responseHeaders: headerArrayToObject(params.responseHeaders || []),
    responseBody,
    responseBodyBase64,
    responseBodyIsBase64: responseBodyEncoded,
    timestamp: Date.now(),
  };

  const matchedRule = evaluateRules(payload, "response");
  if (matchedRule) {
    payload.appliedRule = matchedRule.name || matchedRule.id;
    fireAndForgetLog(payload);

    if (matchedRule.action === "drop") {
      await sendCommand(tabId, "Fetch.failRequest", { requestId: params.requestId, errorReason: "BlockedByClient" });
      return;
    }
    if (matchedRule.action === "modify") {
      let responseHeaders = matchedRule.modifiedResponseHeaders ? headerObjectToArray(matchedRule.modifiedResponseHeaders) : [...(params.responseHeaders || [])];
      if (matchedRule.modifiedResponseBody != null && !matchedRule.modifiedResponseHeaders) {
        responseHeaders = stripEntityHeaders(responseHeaders);
      }
      const responseBodyForFulfill = matchedRule.modifiedResponseBody != null ? encodeUtf8ToBase64(matchedRule.modifiedResponseBody) : responseBodyBase64;
      await sendCommand(tabId, "Fetch.fulfillRequest", {
        requestId: params.requestId,
        responseCode: matchedRule.modifiedStatusCode || params.responseStatusCode || 200,
        responseHeaders,
        body: responseBodyForFulfill || "",
      });
      return;
    }
    await continueResponse(tabId, params.requestId, params, responseBodyBase64);
    return;
  }

  if (state.mode === "listen") {
    fireAndForgetLog(payload);
    await continueResponse(tabId, params.requestId, params, responseBodyBase64);
    return;
  }

  const decision = await fetchDecision(payload);

  if (decision.action === "drop") {
    await sendCommand(tabId, "Fetch.failRequest", {
      requestId: params.requestId,
      errorReason: "BlockedByClient",
    });
    return;
  }

  if (decision.action === "modify") {
    let responseHeaders = decision.modifiedResponseHeaders
      ? headerObjectToArray(decision.modifiedResponseHeaders)
      : [...(params.responseHeaders || [])];

    if (decision.modifiedResponseBody != null && !decision.modifiedResponseHeaders) {
      responseHeaders = stripEntityHeaders(responseHeaders);
    }

    const responseBodyForFulfill = decision.modifiedResponseBody != null
      ? encodeUtf8ToBase64(decision.modifiedResponseBody)
      : responseBodyBase64;

    await sendCommand(tabId, "Fetch.fulfillRequest", {
      requestId: params.requestId,
      responseCode: decision.modifiedStatusCode || params.responseStatusCode || 200,
      responseHeaders,
      body: responseBodyForFulfill || "",
    });
    return;
  }

  await continueResponse(tabId, params.requestId, params, responseBodyBase64);
}

async function handlePausedRequest(tabId, params) {
  if (!state.enabled || state.attachedTabId !== tabId) {
    await continuePausedRequest(tabId, params);
    return;
  }

  // Prevent logging or intercepting traffic going to the MCP bridge/dashboard itself
  try {
    const reqUrl = params.request?.url || "";
    const parsedUrl = new URL(reqUrl);
    const endpointUrl = new URL(state.endpoint);
    if (parsedUrl.origin === endpointUrl.origin) {
      await continuePausedRequest(tabId, params);
      return;
    }
  } catch (e) {
    // Ignore parsing errors
  }

  const isResponsePhase = params.responseStatusCode !== undefined || params.responseErrorReason !== undefined;

  if (isResponsePhase) {
    await handleResponsePause(tabId, params);
    return;
  }

  await handleRequestPause(tabId, params);
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(["webhookUrl", "isEnabled", "mode", "attachedTabId"]).then((stored) => {
    chrome.storage.local.set({
      webhookUrl: stored.webhookUrl || DEFAULT_ENDPOINT,
      isEnabled: stored.isEnabled === true,
      mode: stored.mode === "intercept" ? "intercept" : "listen",
      attachedTabId: Number.isInteger(stored.attachedTabId) ? stored.attachedTabId : null,
    });
  });
});

chrome.runtime.onStartup.addListener(() => {
  loadSettings();
});

loadSettings();


async function sendCdpEvent(event, params) {
  if (!isSecureEndpoint(state.endpoint)) return;
  try {
    const url = new URL(state.endpoint);
    url.pathname = '/api/extension/cdp-result';
    await fetch(url.href, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, params })
    });
  } catch (e) {}
}

chrome.debugger.onEvent.addListener(async (source, method, params) => {
  // If attachedTabId matches, send event over
  if (state.attachedTabId && source.tabId === state.attachedTabId) {
    if (method.startsWith('Fetch.') || (method.startsWith('Network.') && method !== 'Network.webSocketFrameSent' && method !== 'Network.webSocketFrameReceived' && method !== 'Network.webSocketCreated')) {
      // Existing OpenClaw handling handles these
    } else {
      await sendCdpEvent(method, params);
    }
  }

  if (method !== "Fetch.requestPaused" || source.tabId == null) {
    return;
  }

  handlePausedRequest(source.tabId, params).catch(async () => {
    try {
      await continuePausedRequest(source.tabId, params);
    } catch {
      // Ignore secondary failures when the request or tab is already gone.
    }
  });
});

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId === state.attachedTabId) {
    stopRuleSync();
    stopCommandStream();
    state.enabled = false;
    state.attachedTabId = null;
    persistState();
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === state.attachedTabId) {
    stopRuleSync();
    stopCommandStream();
    state.enabled = false;
    state.attachedTabId = null;
    persistState();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_STATUS") {
    getTabLabel(state.attachedTabId).then((tabLabel) => {
      sendResponse({
        enabled: state.enabled,
        mode: state.mode,
        endpoint: state.endpoint,
        attachedTabId: state.attachedTabId,
        attachedTabLabel: tabLabel,
      });
    });

    return true;
  }

  if (message?.type === "SET_MODE") {
    state.mode = message.mode === "intercept" ? "intercept" : "listen";
    if (state.mode === "intercept" && state.attachedTabId) {
      startCommandStream();
    } else {
      stopCommandStream();
    }
    persistState().then(() => {
      sendResponse({ ok: true, mode: state.mode });
    });
    return true;
  }

  if (message?.type === "SAVE_ENDPOINT") {
    const rawEndpoint = message.endpoint || "";
    if (!rawEndpoint.trim()) {
      sendResponse({ ok: false, error: "Enter a webhook endpoint first." });
      return false;
    }

    const nextEndpoint = normalizeEndpoint(rawEndpoint);

    if (!isSecureEndpoint(nextEndpoint)) {
      sendResponse({ ok: false, error: "Use HTTPS or localhost/127.0.0.1 over HTTP." });
      return false;
    }

    state.endpoint = nextEndpoint;
    persistState().then(() => {
      sendResponse({ ok: true, endpoint: state.endpoint });
    });

    return true;
  }

  if (message?.type === "SET_INTERCEPTION") {
    const tabId = Number.isInteger(message.tabId) ? message.tabId : null;
    const enable = message.enable === true;

    (async () => {
      if (enable) {
        if (!isSecureEndpoint(state.endpoint)) {
          sendResponse({ ok: false, error: "Save a valid HTTPS or localhost webhook first." });
          return;
        }

        await attachToTab(tabId);
        state.enabled = true;
      } else {
        await detachFromTab(state.attachedTabId);
        state.enabled = false;
      }

      await persistState();
      sendResponse({ ok: true, enabled: state.enabled, attachedTabId: state.attachedTabId });
    })().catch(async (error) => {
      state.enabled = false;
      state.attachedTabId = null;
      await persistState();
      sendResponse({ ok: false, error: error?.message || String(error) });
    });

    return true;
  }

  return false;
});
