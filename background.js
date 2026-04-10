let MCP_ENDPOINT = "http://127.0.0.1:31337/log";

// Load saved URL from storage
chrome.storage.local.get(['webhookUrl'], (res) => {
  if (res.webhookUrl) MCP_ENDPOINT = res.webhookUrl;
});

// Update URL dynamically if changed in popup
chrome.storage.onChanged.addListener((changes) => {
  if (changes.webhookUrl) MCP_ENDPOINT = changes.webhookUrl.newValue;
});

// Listen for messages from our content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'OPENCLAW_NETWORK_LOG' && message.data) {
    // Prevent infinite loop by ignoring requests to the webhook itself
    if (message.data.url && message.data.url.startsWith(MCP_ENDPOINT)) {
      return;
    }

    fetch(MCP_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message.data)
    }).catch(e => { /* Silently ignore offline server */ });
  }
});