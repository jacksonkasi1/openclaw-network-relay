import { EventEmitter } from "events";

export const cdpEvents = new EventEmitter();
let extensionStream = null;
const pendingCommands = new Map();
let nextCommandId = 1;

export function addExtensionStream(res) {
  if (res) {
    if (extensionStream && extensionStream !== res) {
      try {
        extensionStream.end();
      } catch {}
    }
    extensionStream = res;
    console.error("[CDP] Extension connected to command stream.");
    // Wake up any sendCdpCommand calls that are waiting for the stream to come back.
    cdpEvents.emit("streamConnected");
  }
}

export function clearExtensionStream(res) {
  if (extensionStream === res) {
    extensionStream = null;
    console.error("[CDP] Extension disconnected from command stream.");
  }
}

export function handleCdpResult(body) {
  const { id, result, error, event, params } = body;

  if (event) {
    cdpEvents.emit("event", { event, params });
    return;
  }

  const p = pendingCommands.get(id);
  if (p) {
    pendingCommands.delete(id);
    if (error) {
      p.reject(new Error(error));
    } else {
      p.resolve(result);
    }
  }
}

export function sendCdpCommand(tabId, method, params = {}) {
  return new Promise((resolve, reject) => {
    // Maximum number of 500 ms polling slots to wait for the stream.
    // 40 × 500 ms = 20 s, giving the MV3 service worker enough time to be
    // woken by the chrome.alarms keepalive and re-establish the SSE stream.
    const MAX_ATTEMPTS = 40;

    const trySend = (attempts = 0) => {
      // Also treat a writableEnded / destroyed stream as "not connected" so we
      // don't silently swallow writes on Bun where write() may not throw.
      const streamDead =
        extensionStream &&
        (extensionStream.writableEnded === true ||
          extensionStream.destroyed === true ||
          extensionStream.finished === true);

      if (!extensionStream || streamDead) {
        if (streamDead) {
          // Purge the stale reference so the next reconnect overwrites it cleanly.
          try {
            extensionStream.end();
          } catch {}
          extensionStream = null;
        }
        if (attempts >= MAX_ATTEMPTS) {
          return reject(
            new Error(
              "Chrome Extension is not connected to the command stream. Is the extension turned ON and attached to a tab?",
            ),
          );
        }
        // Wait for whichever comes first: the stream reconnecting (instant wake)
        // or a 500 ms polling timeout.  This way MCP calls resume the moment
        // the extension SSE stream re-establishes rather than waiting a full
        // polling tick.
        let settled = false;
        const onConnect = () => {
          if (settled) return;
          settled = true;
          trySend(attempts + 1);
        };
        cdpEvents.once("streamConnected", onConnect);
        setTimeout(() => {
          if (settled) return;
          settled = true;
          cdpEvents.removeListener("streamConnected", onConnect);
          trySend(attempts + 1);
        }, 500);
        return;
      }

      const id = nextCommandId++;
      pendingCommands.set(id, { resolve, reject });

      const payload = JSON.stringify({ id, tabId, method, params });
      try {
        extensionStream.write(`data: ${payload}\n\n`);
      } catch (e) {
        pendingCommands.delete(id);
        if (attempts < 10) {
          setTimeout(() => trySend(attempts + 1), 500);
          return;
        }
        // Stream write failed — null it out so the next trySend treats it as
        // disconnected and waits for a fresh reconnect.
        extensionStream = null;
        if (attempts < MAX_ATTEMPTS) {
          let settled = false;
          const onConnect = () => {
            if (settled) return;
            settled = true;
            trySend(attempts + 1);
          };
          cdpEvents.once("streamConnected", onConnect);
          setTimeout(() => {
            if (settled) return;
            settled = true;
            cdpEvents.removeListener("streamConnected", onConnect);
            trySend(attempts + 1);
          }, 500);
          return;
        }
        return reject(
          new Error("Failed to write to extension stream: " + e.message),
        );
      }

      setTimeout(() => {
        if (pendingCommands.has(id)) {
          pendingCommands.delete(id);
          reject(new Error(`CDP Command ${method} timed out after 15s`));
        }
      }, 15000);
    };

    trySend();
  });
}

export function safeSerialize(value) {
  if (value === undefined) {
    return "Execution successful (returned undefined)";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    const json = JSON.stringify(value);
    if (json === undefined) {
      return "Execution successful (returned undefined)";
    }
    return json;
  } catch {
    try {
      return String(value);
    } catch {
      return "Execution completed (unserializable result)";
    }
  }
}

export function normalizeCDPResult(result) {
  if (!result) return "Execution completed (no result)";
  if ("value" in result) return safeSerialize(result.value);
  if (result.unserializableValue) return result.unserializableValue;
  if (result.description) return result.description;
  return "Execution completed (unknown result)";
}
