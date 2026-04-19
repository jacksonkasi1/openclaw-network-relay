const DEFAULT_ENDPOINT = "http://127.0.0.1:31337/log";
const DEBUGGER_VERSION = "1.3";
const DECISION_TIMEOUT_MS = 20000;
const DEBUG_RULES = true; // Set to false in production - controls verbose logging for rule sync

// MANIFEST V3 KEEPALIVE — TWO LAYERS
// 1. setInterval pings Chrome every 20s to keep a LIVE SW alive.
// 2. chrome.alarms fires every ~20s and WAKES the SW if Chrome killed it.
//    Alarms survive SW termination; setInterval does not.
let keepAliveInterval = null;

function ensureWorkerAlive() {
  // Layer 1: keep a running SW alive
  if (keepAliveInterval) clearInterval(keepAliveInterval);
  keepAliveInterval = setInterval(() => {
    if (state.enabled) chrome.runtime.getPlatformInfo(() => {});
  }, 20000);

  // Layer 2: schedule a wake-up alarm (non-repeating so we can use sub-minute
  // delays on unpacked extensions; we reschedule in the handler).
  chrome.alarms.create("keepAlive", { delayInMinutes: 0.33 }); // ~20 s
}

// Must be registered at top-level (not inside a function) to survive SW restarts.
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "keepAlive") return;

  // Ping a Chrome API so the SW stays awake for the next interval.
  chrome.runtime.getPlatformInfo(() => {});

  if (state.enabled) {
    // If the SW was killed and just woke up, the command stream will be gone.
    // Re-establish it immediately so MCP calls can resume.
    if (
      !state.commandStream &&
      state.attachedTabIds.length > 0 &&
      state.endpoint
    ) {
      console.log("[Alarm] SW woke up — command stream missing, reconnecting…");
      startCommandStream();
    }
  }

  // Reschedule (non-repeating alarms work at sub-minute granularity for
  // unpacked/dev extensions; repeating alarms require ≥1 min in production).
  chrome.alarms.create("keepAlive", { delayInMinutes: 0.33 });
});

const state = {
  endpoint: DEFAULT_ENDPOINT,
  enabled: false,
  mode: "listen",
  attachedTabIds: [],
  rules: [],
  ruleSyncInterval: null,
  ruleSyncInFlight: false,
  commandStream: null,
  reconnectTimer: null,
};

function targetForTab(tabId) {
  return { tabId };
}

function isSecureEndpoint(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(url.hostname))
    );
  } catch {
    if (DEBUG_RULES) console.log("[OpenClaw] isSecureEndpoint failed for:", value);
    return false;
  }
}

function normalizeEndpoint(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || DEFAULT_ENDPOINT;
}

function stripEntityHeaders(headers = []) {
  return headers.filter(
    (h) =>
      !/^(content-length|content-encoding|transfer-encoding)$/i.test(h.name),
  );
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

  // Use endpoint or fallback to default
  let endpointToUse = state.endpoint || DEFAULT_ENDPOINT;
  
  if (!isSecureEndpoint(endpointToUse)) {
    if (DEBUG_RULES) console.log("[OpenClaw] syncRules: endpoint not secure, trying default");
    endpointToUse = DEFAULT_ENDPOINT;
  }

  try {
    const rulesUrl = new URL(endpointToUse);
    rulesUrl.pathname = "/rules";
    const res = await fetch(rulesUrl.href);
    if (res.ok) {
      const nextRules = await res.json();
      if (Array.isArray(nextRules)) {
        state.rules = nextRules;
        // Always log rule count - important for debugging
        console.log("[OpenClaw] Rules synced:", state.rules.length, "rules from MCP server");
        if (DEBUG_RULES) {
          state.rules.forEach((r, i) => console.log(`  [${i}] ${r.name} -> ${r.urlPattern}`));
        }
      }
    } else {
      if (DEBUG_RULES) console.log("[OpenClaw] syncRules: HTTP", res.status);
    }
  } catch (e) {
    console.error("[OpenClaw] syncRules error:", e?.message || String(e));
  } finally {
    state.ruleSyncInFlight = false;
  }
}

// --- CDP Command Stream ---
function getCommandStreamUrl() {
  let baseUrlStr = state.endpoint;
  if (baseUrlStr.endsWith("/log")) baseUrlStr = baseUrlStr.slice(0, -4);
  const url = new URL(baseUrlStr);
  url.pathname = "/api/extension/commands";
  return url.href;
}

async function handleIncomingCommand(msg) {
  if (!msg?.id || !msg?.method) return;

  try {
    const isTabCommand =
      msg.method === "Target.createTarget" ||
      msg.method === "Target.closeTarget" ||
      msg.method === "Target.activateTarget" ||
      msg.method === "Target.getTabs";

    if (isTabCommand) {
      if (msg.method === "Target.createTarget") {
        const url =
          typeof msg.params?.url === "string" ? msg.params.url : "about:blank";
        const tab = await chrome.tabs.create({ url, active: false });
        if (!tab.id) throw new Error("Failed to create tab");

        await new Promise((r) => setTimeout(r, 200));
        await chrome.debugger
          .attach({ tabId: tab.id }, DEBUGGER_VERSION)
          .catch(() => null);
        await chrome.debugger
          .sendCommand({ tabId: tab.id }, "Page.enable")
          .catch(() => null);
        await chrome.debugger
          .sendCommand({ tabId: tab.id }, "Network.enable")
          .catch(() => null);
        await chrome.debugger
          .sendCommand(
            { tabId: tab.id },
            "Page.addScriptToEvaluateOnNewDocument",
            {
              source:
                "Object.defineProperty(navigator, 'webdriver', { get: () => false }); window.chrome = window.chrome || {}; window.chrome.runtime = window.chrome.runtime || {};",
            },
          )
          .catch(() => null);

        const info = await chrome.debugger
          .sendCommand({ tabId: tab.id }, "Target.getTargetInfo")
          .catch(() => null);
        const targetId = String(info?.targetInfo?.targetId || "").trim();
        await sendCdpResult(msg.id, { targetId, tabId: tab.id }, null);
        return;
      }

      if (msg.method === "Target.closeTarget") {
        const targetTabId =
          msg.params?.tabId ||
          (state.attachedTabIds.length > 0 ? state.attachedTabIds[0] : null);
        await chrome.tabs.remove(targetTabId).catch(() => null);
        await sendCdpResult(msg.id, { success: true }, null);
        return;
      }

      if (msg.method === "Target.activateTarget") {
        const targetTabId =
          msg.params?.tabId ||
          (state.attachedTabIds.length > 0 ? state.attachedTabIds[0] : null);
        const tab = await chrome.tabs.get(targetTabId).catch(() => null);
        if (tab?.windowId) {
          await chrome.windows
            .update(tab.windowId, { focused: true })
            .catch(() => {});
        }
        await chrome.tabs.update(targetTabId, { active: true }).catch(() => {});
        await sendCdpResult(msg.id, { success: true }, null);
        return;
      }

      if (msg.method === "Target.getTabs") {
        const allTabs = await chrome.tabs.query({});
        await sendCdpResult(msg.id, { tabs: allTabs }, null);
        return;
      }
    }

    const tabId =
      msg.params?.tabId ||
      msg.tabId ||
      (state.attachedTabIds.length > 0 ? state.attachedTabIds[0] : null);
    const result = await chrome.debugger.sendCommand(
      { tabId },
      msg.method,
      msg.params,
    );
    await sendCdpResult(msg.id, result, null);
  } catch (e) {
    await sendCdpResult(msg.id, null, e?.message || String(e));
  }
}

function startCommandStream() {
  stopCommandStream();

  if (!state.enabled || state.attachedTabIds.length === 0 || !state.endpoint)
    return;

  try {
    const es = new EventSource(getCommandStreamUrl());
    state.commandStream = es;

    es.addEventListener("ready", () => {
      console.log("Command stream ready.");
    });

    es.onopen = () => {
      console.log("Command stream officially OPEN");
    };

    es.addEventListener("ping", () => {
      // no-op, just keeps the stream active
    });

    es.addEventListener("message", (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        console.error("Failed to parse command payload:", e);
        return;
      }
      void handleIncomingCommand(msg);
    });

    es.onerror = () => {
      if (state.enabled && state.commandStream === es) {
        console.error(
          "Command stream error; Forcing complete teardown and explicit reconnect.",
        );
        stopCommandStream();
        state.reconnectTimer = setTimeout(startCommandStream, 1500);
      }
    };
  } catch (e) {
    console.error("Failed to start command stream:", e?.message || String(e));
    if (state.enabled) {
      state.reconnectTimer = setTimeout(startCommandStream, 1000);
    }
  }
}

function stopCommandStream() {
  if (state.commandStream) {
    try {
      state.commandStream.close();
    } catch {}
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
    if (baseUrlStr.endsWith("/log"))
      baseUrlStr = baseUrlStr.replace("/log", "");
    const url = new URL(baseUrlStr);
    url.pathname = "/api/extension/cdp-result";
    await fetch(url.href, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, result, error }),
    });
  } catch (e) {}
}

function startRuleSync() {
  if (DEBUG_RULES) console.log("[OpenClaw] startRuleSync: enabled =", state.enabled);
  if (state.ruleSyncInterval) clearInterval(state.ruleSyncInterval);
  state.ruleSyncInFlight = false;
  void syncRules();
  state.ruleSyncInterval = setInterval(() => {
    void syncRules();
  }, 2000);
}

function stopRuleSync() {
  if (state.ruleSyncInterval) clearInterval(state.ruleSyncInterval);
  state.ruleSyncInterval = null;
  state.ruleSyncInFlight = false;
  state.rules = [];
}

let _warnedNoRules = false;

function evaluateRules(payload, phase) {
  if (!state.rules || state.rules.length === 0) {
    if (!_warnedNoRules && DEBUG_RULES) {
      console.log("[OpenClaw] evaluateRules: no rules loaded yet");
      _warnedNoRules = true;
    }
    return null;
  }
  // Reset warning when rules are available
  _warnedNoRules = false;
  
  for (const rule of state.rules) {
    if (rule.phase && rule.phase !== phase && rule.phase !== "both") continue;
    if (
      rule.method &&
      rule.method.toUpperCase() !== payload.method.toUpperCase()
    )
      continue;
    if (rule.urlPattern && !payload.url.includes(rule.urlPattern)) continue;
    if (DEBUG_RULES) console.log("[OpenClaw] MATCHED rule:", rule.name, "->", payload.url);
    return rule;
  }
  return null;
}

async function persistState() {
  await chrome.storage.local.set({
    webhookUrl: state.endpoint,
    isEnabled: state.enabled,
    mode: state.mode,
    attachedTabIds: state.attachedTabIds,
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

  state.attachedTabIds = state.attachedTabIds.filter((id) => id !== tabId);
  if (state.attachedTabIds.length === 0) {
    stopRuleSync();
    stopCommandStream();
  }
}

async function attachToTab(tabId) {
  if (DEBUG_RULES) console.log("[OpenClaw] attachToTab:", tabId);
  if (tabId == null) throw new Error("No target tab selected");
  if (!state.attachedTabIds.includes(tabId)) {
    // We are no longer detaching from other tabs because we support multiple tabs now.
  }

  try {
    await chrome.debugger.attach(targetForTab(tabId), DEBUGGER_VERSION);
  } catch (error) {
    if (
      !String(error?.message || error).includes(
        "Another debugger is already attached",
      )
    ) {
      throw error;
    }
  }

  await sendCommand(tabId, "Page.enable");
  await sendCommand(tabId, "Network.enable");
  await sendCommand(tabId, "Page.addScriptToEvaluateOnNewDocument", {
    source:
      "Object.defineProperty(navigator, 'webdriver', { get: () => false }); window.chrome = window.chrome || {}; window.chrome.runtime = window.chrome.runtime || {};",
  });

  await sendCommand(tabId, "Fetch.enable", {
    patterns: [
      { urlPattern: "*", requestStage: "Request" },
      { urlPattern: "*", requestStage: "Response" },
    ],
  });

  if (!state.attachedTabIds.includes(tabId)) {
    state.attachedTabIds.push(tabId);
  }
  // Always log successful attachment - important for debugging
  console.log("[OpenClaw] Tab attached:", tabId, "- rules syncing every 2s");
  startRuleSync();
  startCommandStream();
  ensureWorkerAlive();
}

async function loadSettings() {
  const stored = await chrome.storage.local.get([
    "webhookUrl",
    "isEnabled",
    "mode",
    "attachedTabIds",
  ]);

  state.endpoint = normalizeEndpoint(stored.webhookUrl);
  state.enabled = stored.isEnabled === true;
  state.mode = stored.mode === "intercept" ? "intercept" : "listen";
  state.attachedTabIds = Array.isArray(stored.attachedTabIds)
    ? stored.attachedTabIds
    : [];

  if (state.enabled && state.attachedTabIds.length > 0) {
    const validTabIds = [];
    for (const tabId of state.attachedTabIds) {
      try {
        await chrome.tabs.get(tabId);
        await attachToTab(tabId);
        validTabIds.push(tabId);
      } catch {
        // Ignore
      }
    }
    state.attachedTabIds = validTabIds;

    if (state.attachedTabIds.length === 0) {
      try {
        let tabs = await chrome.tabs.query({
          active: true,
          lastFocusedWindow: true,
        });
        if (tabs.length === 0) {
          tabs = await chrome.tabs.query({ active: true });
        }
        if (tabs.length > 0) {
          await attachToTab(tabs[0].id);
          await persistState();
        } else {
          state.attachedTabIds = [];
          await persistState();
        }
      } catch {
        state.attachedTabIds = [];
        await persistState();
      }
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

async function continueResponse(
  tabId,
  requestId,
  responseParams = null,
  responseBodyBase64 = null,
) {
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
  const isResponsePhase =
    params.responseStatusCode !== undefined ||
    params.responseErrorReason !== undefined;

  if (isResponsePhase) {
    await continueResponse(tabId, params.requestId, params, responseBodyBase64);
    return;
  }

  await sendCommand(tabId, "Fetch.continueRequest", {
    requestId: params.requestId,
  });
}

function fireAndForgetLog(payload) {
  if (!isSecureEndpoint(state.endpoint)) return;
  fetch(state.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {});
}

async function handleRequestPause(tabId, params) {
  let requestBody = params.request.postData ?? null;

  // Prevent massive file uploads (multipart/form-data or raw binary streams) from crashing the extension
  // or being corrupted by the Chrome Debugger API when forwarded.
  const contentType =
    headerArrayToObject(headerObjectToArray(params.request.headers || {}))[
      "content-type"
    ] || "";
  if (
    contentType.includes("multipart/form-data") ||
    (requestBody && requestBody.length > 5000000)
  ) {
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
      await sendCommand(tabId, "Fetch.failRequest", {
        requestId: params.requestId,
        errorReason: "BlockedByClient",
      });
      return;
    }
    if (matchedRule.action === "modify") {
      await sendCommand(tabId, "Fetch.continueRequest", {
        requestId: params.requestId,
        url: matchedRule.modifiedUrl,
        method: matchedRule.modifiedMethod,
        postData:
          matchedRule.modifiedBody != null
            ? encodeUtf8ToBase64(matchedRule.modifiedBody)
            : undefined,
        headers: matchedRule.modifiedHeaders
          ? headerObjectToArray(matchedRule.modifiedHeaders)
          : undefined,
      });
      return;
    }
    await sendCommand(tabId, "Fetch.continueRequest", {
      requestId: params.requestId,
    });
    return;
  }

  if (state.mode === "listen") {
    fireAndForgetLog(payload);
    await sendCommand(tabId, "Fetch.continueRequest", {
      requestId: params.requestId,
    });
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
      postData:
        decision.modifiedBody != null
          ? encodeUtf8ToBase64(decision.modifiedBody)
          : undefined,
      headers: decision.modifiedHeaders
        ? headerObjectToArray(decision.modifiedHeaders)
        : undefined,
    });
    return;
  }

  await sendCommand(tabId, "Fetch.continueRequest", {
    requestId: params.requestId,
  });
}

async function handleResponsePause(tabId, params) {
  let responseBody = null;
  let responseBodyBase64 = null;
  let responseBodyEncoded = false;

  try {
    const bodyResult = await sendCommand(tabId, "Fetch.getResponseBody", {
      requestId: params.requestId,
    });
    responseBody = bodyResult.body;
    responseBodyBase64 = bodyResult.base64Encoded
      ? bodyResult.body
      : encodeUtf8ToBase64(bodyResult.body);
    responseBodyEncoded = bodyResult.base64Encoded;
    if (bodyResult.base64Encoded) {
      try {
        const binary = atob(bodyResult.body);
        const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
        responseBody = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch (e) {
        responseBody = bodyResult.body;
      }
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

  // Debug: Log rule state before evaluation
  if (DEBUG_RULES) {
    console.log("[OpenClaw] Response for:", params.request.url);
    console.log("[OpenClaw] Rules in state:", state.rules ? state.rules.length : 0);
  }

  const matchedRule = evaluateRules(payload, "response");
  if (matchedRule) {
    // Always log when a rule is applied - this is important for debugging
    console.log("[OpenClaw] RULE APPLIED:", matchedRule.name, "->", params.request.url);
    payload.appliedRule = matchedRule.name || matchedRule.id;
    fireAndForgetLog(payload);

    if (matchedRule.action === "drop") {
      await sendCommand(tabId, "Fetch.failRequest", {
        requestId: params.requestId,
        errorReason: "BlockedByClient",
      });
      return;
    }
    if (matchedRule.action === "modify") {
      if (DEBUG_RULES) console.log("[OpenClaw] Modifying response body");
      let responseHeaders = matchedRule.modifiedResponseHeaders
        ? headerObjectToArray(matchedRule.modifiedResponseHeaders)
        : [...(params.responseHeaders || [])];
      if (
        matchedRule.modifiedResponseBody != null &&
        !matchedRule.modifiedResponseHeaders
      ) {
        responseHeaders = stripEntityHeaders(responseHeaders);
      }
      const responseBodyForFulfill =
        matchedRule.modifiedResponseBody != null
          ? encodeUtf8ToBase64(matchedRule.modifiedResponseBody)
          : responseBodyBase64;
      await sendCommand(tabId, "Fetch.fulfillRequest", {
        requestId: params.requestId,
        responseCode:
          matchedRule.modifiedStatusCode || params.responseStatusCode || 200,
        responseHeaders,
        body: responseBodyForFulfill || "",
      });
      if (DEBUG_RULES) console.log("[OpenClaw] Response modification complete");
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

    if (
      decision.modifiedResponseBody != null &&
      !decision.modifiedResponseHeaders
    ) {
      responseHeaders = stripEntityHeaders(responseHeaders);
    }

    const responseBodyForFulfill =
      decision.modifiedResponseBody != null
        ? encodeUtf8ToBase64(decision.modifiedResponseBody)
        : responseBodyBase64;

    await sendCommand(tabId, "Fetch.fulfillRequest", {
      requestId: params.requestId,
      responseCode:
        decision.modifiedStatusCode || params.responseStatusCode || 200,
      responseHeaders,
      body: responseBodyForFulfill || "",
    });
    return;
  }

  await continueResponse(tabId, params.requestId, params, responseBodyBase64);
}

async function handlePausedRequest(tabId, params) {
  if (!state.enabled || !state.attachedTabIds.includes(tabId)) {
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

  const isResponsePhase =
    params.responseStatusCode !== undefined ||
    params.responseErrorReason !== undefined;

  if (isResponsePhase) {
    await handleResponsePause(tabId, params);
    return;
  }

  await handleRequestPause(tabId, params);
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local
    .get(["webhookUrl", "isEnabled", "mode", "attachedTabIds"])
    .then((stored) => {
      chrome.storage.local.set({
        webhookUrl: stored.webhookUrl || DEFAULT_ENDPOINT,
        isEnabled: stored.isEnabled === true,
        mode: stored.mode === "intercept" ? "intercept" : "listen",
        attachedTabIds: Array.isArray(stored.attachedTabIds)
          ? stored.attachedTabIds
          : [],
      });
    });
});

chrome.runtime.onStartup.addListener(() => {
  loadSettings();
});

loadSettings();
// Always log on startup - important for debugging
console.log("[OpenClaw] Extension loaded - MCP bridge endpoint:", DEFAULT_ENDPOINT);

// Start rule syncing immediately on extension load - don't wait for tab attachment
// This ensures rules are ready before any tab is attached
startRuleSync();

async function sendCdpEvent(event, params) {
  if (!isSecureEndpoint(state.endpoint)) return;
  try {
    const url = new URL(state.endpoint);
    url.pathname = "/api/extension/cdp-result";
    await fetch(url.href, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, params }),
    });
  } catch (e) {}
}

chrome.debugger.onEvent.addListener(async (source, method, params) => {
  // If attachedTabIds includes the tab, send event over
  if (source.tabId && state.attachedTabIds.includes(source.tabId)) {
    if (
      method.startsWith("Fetch.") ||
      (method.startsWith("Network.") &&
        method !== "Network.webSocketFrameSent" &&
        method !== "Network.webSocketFrameReceived" &&
        method !== "Network.webSocketCreated")
    ) {
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

chrome.debugger.onDetach.addListener((source, reason) => {
  if (source.tabId && state.attachedTabIds.includes(source.tabId)) {
    state.attachedTabIds = state.attachedTabIds.filter(
      (id) => id !== source.tabId,
    );
    if (state.attachedTabIds.length === 0) {
      stopRuleSync();
      stopCommandStream();
      if (keepAliveInterval) clearInterval(keepAliveInterval);
    }
    if (reason !== "target_closed") {
      persistState();
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  if (state.attachedTabIds.includes(tabId)) {
    state.attachedTabIds = state.attachedTabIds.filter((id) => id !== tabId);
    if (state.attachedTabIds.length === 0) {
      stopRuleSync();
      stopCommandStream();
      if (keepAliveInterval) clearInterval(keepAliveInterval);
    }
    if (!removeInfo.isWindowClosing) {
      persistState();
    }
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_STATUS") {
    const primaryTabId =
      state.attachedTabIds.length > 0 ? state.attachedTabIds[0] : null;
    getTabLabel(primaryTabId).then((tabLabel) => {
      sendResponse({
        enabled: state.enabled,
        mode: state.mode,
        endpoint: state.endpoint,
        attachedTabId: primaryTabId,
        attachedTabIds: state.attachedTabIds,
        attachedTabLabel:
          state.attachedTabIds.length > 1
            ? `${state.attachedTabIds.length} tabs attached`
            : tabLabel,
      });
    });

    return true;
  }

  if (message?.type === "SET_MODE") {
    state.mode = message.mode === "intercept" ? "intercept" : "listen";
    // The command stream is needed for ALL MCP browser tools regardless of
    // intercept vs. listen mode — never shut it down just because the mode changed.
    if (state.enabled && state.attachedTabId) {
      startCommandStream();
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
      sendResponse({
        ok: false,
        error: "Use HTTPS or localhost/127.0.0.1 over HTTP.",
      });
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
          sendResponse({
            ok: false,
            error: "Save a valid HTTPS or localhost webhook first.",
          });
          return;
        }

        // Must set state.enabled = true BEFORE calling attachToTab so that
        // startCommandStream() (called at the tail of attachToTab) passes its
        // guard check.  We roll it back below if attachToTab throws.
        state.enabled = true;
        if (tabId != null) {
          await attachToTab(tabId);
        }
      } else {
        if (tabId != null) {
          await detachFromTab(tabId);
        }
        if (state.attachedTabIds.length === 0) {
          state.enabled = false;
        }
      }

      await persistState();
      sendResponse({
        ok: true,
        enabled: state.enabled,
        attachedTabId: tabId,
        attachedTabIds: state.attachedTabIds,
      });
    })().catch(async (error) => {
      if (state.attachedTabIds.length === 0) {
        state.enabled = false;
      }
      await persistState();
      sendResponse({ ok: false, error: error?.message || String(error) });
    });

    return true;
  }

  return false;
});
