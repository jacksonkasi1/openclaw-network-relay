window.addEventListener('message', (event) => {
    // Only accept messages from the same window
    if (event.source !== window) return;

    if (event.data && event.data.type === 'OPENCLAW_NETWORK_LOG') {
        chrome.runtime.sendMessage(event.data);
    }
});