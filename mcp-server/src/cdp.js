let extensionStream = null;
const pendingCommands = new Map();
let nextCommandId = 1;

export function addExtensionStream(res) {
  if (extensionStream && res) {
    extensionStream.end();
  }
  extensionStream = res;
  if (res) {
    console.error("[CDP] Extension connected to command stream.");
  } else {
    console.error("[CDP] Extension disconnected from command stream.");
  }
}

export function handleCdpResult(body) {
  const { id, result, error } = body;
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
    if (!extensionStream) {
      return reject(new Error("Chrome Extension is not connected to the command stream. Is Intercept mode enabled and attached to a tab?"));
    }

    const id = nextCommandId++;
    pendingCommands.set(id, { resolve, reject });

    const payload = JSON.stringify({ id, tabId, method, params });
    extensionStream.write(`data: ${payload}\n\n`);

    // Timeout after 15 seconds
    setTimeout(() => {
      if (pendingCommands.has(id)) {
        pendingCommands.delete(id);
        reject(new Error(`CDP Command ${method} timed out after 15s`));
      }
    }, 15000);
  });
}
