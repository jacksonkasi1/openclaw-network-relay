const DEFAULT_ENDPOINT = "http://127.0.0.1:31337/log";
const DEBUGGER_VERSION = "1.3";
const DECISION_TIMEOUT_MS = 20000;

const state = {
  endpoint: DEFAULT_ENDPOINT,
  enabled: false,
  attachedTabId: null,
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

function headerObjectToArray(headers = {}) {
  return Object.entries(headers).map(([name, value]) => ({
    name,
    value: String(value),
  }));
}

function headerArrayToObject(headers = []) {
  const result = {};

  for (const header of headers) {
    if (!header || !header.name) {
      continue;
    }

    result[header.name.toLowerCase()] = header.value ?? "";
  }

  return result;
}

function encodeUtf8ToBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

async function sendCommand(tabId, method, params = {}) {
  return chrome.debugger.sendCommand(targetForTab(tabId), method, params);
}

async function persistState() {
  await chrome.storage.local.set({
    webhookUrl: state.endpoint,
    isEnabled: state.enabled,
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
}

async function attachToTab(tabId) {
  if (tabId == null) {
    throw new Error("No target tab selected");
  }

  if (state.attachedTabId != null && state.attachedTabId !== tabId) {
    await detachFromTab(state.attachedTabId);
  }

  if (state.attachedTabId === tabId) {
    return;
  }

  try {
    await chrome.debugger.attach(targetForTab(tabId), DEBUGGER_VERSION);
  } catch (error) {
    if (!String(error?.message || error).includes("Another debugger is already attached")) {
      throw error;
    }
  }

  await sendCommand(tabId, "Fetch.enable", {
    patterns: [
      { urlPattern: "*", requestStage: "Request" },
      { urlPattern: "*", requestStage: "Response" },
    ],
  });

  state.attachedTabId = tabId;
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(["webhookUrl", "isEnabled", "attachedTabId"]);

  state.endpoint = normalizeEndpoint(stored.webhookUrl);
  state.enabled = stored.isEnabled === true;
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
      await sendCommand(tabId, "Fetch.fulfillRequest", {
        requestId,
        responseCode: responseParams.responseStatusCode,
        responseHeaders: responseParams.responseHeaders || [],
        body: responseBodyBase64 || "",
      });
      return;
    }

    await sendCommand(tabId, "Fetch.continueRequest", { requestId });
  }
}

async function continuePausedRequest(tabId, params, responseBodyBase64 = null) {
  if (params.responseStatusCode) {
    await continueResponse(tabId, params.requestId, params, responseBodyBase64);
    return;
  }

  await sendCommand(tabId, "Fetch.continueRequest", { requestId: params.requestId });
}

async function handleRequestPause(tabId, params) {
  const decision = await fetchDecision({
    id: `${params.requestId}:request`,
    phase: "request",
    tabId,
    url: params.request.url,
    method: params.request.method,
    resourceType: params.resourceType,
    requestHeaders: params.request.headers || {},
    requestBody: params.request.postData ?? null,
    timestamp: Date.now(),
  });

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
      postData: decision.modifiedBody,
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
  } catch {
    responseBody = null;
    responseBodyBase64 = null;
  }

  const decision = await fetchDecision({
    id: `${params.requestId}:response`,
    phase: "response",
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
  });

  if (decision.action === "drop") {
    await sendCommand(tabId, "Fetch.failRequest", {
      requestId: params.requestId,
      errorReason: "BlockedByClient",
    });
    return;
  }

  if (decision.action === "modify") {
    const responseHeaders = decision.modifiedResponseHeaders
      ? headerObjectToArray(decision.modifiedResponseHeaders)
      : (params.responseHeaders || []);

    const responseBodyForFulfill = decision.modifiedResponseBody != null
      ? encodeUtf8ToBase64(decision.modifiedResponseBody)
      : responseBodyBase64;

    await sendCommand(tabId, "Fetch.fulfillRequest", {
      requestId: params.requestId,
      responseCode: decision.modifiedStatusCode || params.responseStatusCode,
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

  if (params.responseStatusCode) {
    await handleResponsePause(tabId, params);
    return;
  }

  await handleRequestPause(tabId, params);
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(["webhookUrl", "isEnabled", "attachedTabId"]).then((stored) => {
    chrome.storage.local.set({
      webhookUrl: stored.webhookUrl || DEFAULT_ENDPOINT,
      isEnabled: stored.isEnabled === true,
      attachedTabId: Number.isInteger(stored.attachedTabId) ? stored.attachedTabId : null,
    });
  });
});

chrome.runtime.onStartup.addListener(() => {
  loadSettings();
});

loadSettings();

chrome.debugger.onEvent.addListener((source, method, params) => {
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
    state.enabled = false;
    state.attachedTabId = null;
    persistState();
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === state.attachedTabId) {
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
        endpoint: state.endpoint,
        attachedTabId: state.attachedTabId,
        attachedTabLabel: tabLabel,
      });
    });

    return true;
  }

  if (message?.type === "SAVE_ENDPOINT") {
    const nextEndpoint = normalizeEndpoint(message.endpoint);

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
    })().catch((error) => {
      sendResponse({ ok: false, error: error?.message || String(error) });
    });

    return true;
  }

  return false;
});
