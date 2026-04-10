let MCP_ENDPOINT = "http://127.0.0.1:31337/log";
let isEnabled = true;

// Load saved URL and state from storage
chrome.storage.local.get(['webhookUrl', 'isEnabled'], (res) => {
  if (res.webhookUrl) MCP_ENDPOINT = res.webhookUrl;
  if (res.isEnabled !== undefined) isEnabled = res.isEnabled;
});

// Update settings dynamically if changed in popup
chrome.storage.onChanged.addListener((changes) => {
  if (changes.webhookUrl) MCP_ENDPOINT = changes.webhookUrl.newValue;
  if (changes.isEnabled) isEnabled = changes.isEnabled.newValue;
});

// Listen for messages from our content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // If extension is OFF, instantly forward the traffic without interception
  if (!isEnabled) {
    sendResponse({ action: 'forward' });
    return true;
  }

  if (message.type === 'OPENCLAW_NETWORK_LOG' && message.data) {
    // Prevent infinite loop by ignoring requests to the webhook itself
    if (message.data.url && message.data.url.startsWith(MCP_ENDPOINT)) {
      sendResponse({ action: 'forward' });
      return true;
    }

    // Forward the traffic to the AI Agent and wait for its decision
    fetch(MCP_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message.data)
    })
    .then(res => res.json())
    .then(agentDecision => {
      // Send the agent's decision back to the webpage script
      sendResponse(agentDecision);
    })
    .catch(e => {
      // If server is offline, just forward traffic normally so browser doesn't break
      sendResponse({ action: 'forward' });
    });

    // Return true to indicate we will send a response asynchronously
    return true;
  }
});