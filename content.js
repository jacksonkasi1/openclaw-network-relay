window.addEventListener('message', (event) => {
    // Only accept messages from the same window
    if (event.source !== window) return;

    if (event.data && event.data.type === 'OPENCLAW_NETWORK_LOG') {
        // Send to background script and wait for the Agent's response callback
        chrome.runtime.sendMessage(event.data, (response) => {
            // Forward the Agent's decision back to the injected script
            window.postMessage({
                type: 'OPENCLAW_INTERCEPT_REPLY',
                id: event.data.data.id,
                result: response || { action: 'forward' }
            }, '*');
        });
    }
});