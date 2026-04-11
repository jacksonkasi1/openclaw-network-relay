import { EventEmitter } from 'events';

export const cdpEvents = new EventEmitter();
let extensionStream = null;
const pendingCommands = new Map();
let nextCommandId = 1;

export function addExtensionStream(res) {
  // If we are replacing an existing stream with a NEW stream, end the old one gracefully.
  // But DO NOT drop pendingCommands, because the AI is still waiting on them!
  if (extensionStream && res && extensionStream !== res) {
    try { extensionStream.end(); } catch (e) {}
  }
  
  // If res is null (disconnect), only clear extensionStream if it hasn't already been replaced
  if (!res) {
    // We don't want to nullify if a new connection already snuck in
    // However, the HTTP close event might trigger late, so we leave it alone unless we really want to track IDs
    console.error("[CDP] Extension disconnected from command stream.");
  } else {
    console.error("[CDP] Extension connected to command stream.");
  }
  
  extensionStream = res;
}

export function handleCdpResult(body) {
  const { id, result, error, event, params } = body;

  if (event) {
    cdpEvents.emit('event', { event, params });
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
    const trySend = (attempts = 0) => {
      if (!extensionStream) {
        if (attempts < 10) {
          setTimeout(() => trySend(attempts + 1), 500);
          return;
        }
        return reject(new Error("Chrome Extension is not connected to the command stream. Is the extension turned ON and attached to a tab?"));
      }

      const id = nextCommandId++;
      pendingCommands.set(id, { resolve, reject });

      const payload = JSON.stringify({ id, tabId, method, params });
      try {
        extensionStream.write(`data: ${payload}\n\n`);
      } catch (e) {
        if (attempts < 10) {
          setTimeout(() => trySend(attempts + 1), 500);
          return;
        }
        return reject(new Error("Failed to write to extension stream: " + e.message));
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
