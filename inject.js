// Helper: Pause JS execution and ask the AI Agent what to do
function askAgentAndWait(requestData) {
    return new Promise(resolve => {
        const id = crypto.randomUUID();
        requestData.id = id;

        const listener = (event) => {
            if (event.source !== window || !event.data || event.data.type !== 'OPENCLAW_INTERCEPT_REPLY' || event.data.id !== id) return;
            window.removeEventListener('message', listener);
            resolve(event.data.result);
        };
        
        window.addEventListener('message', listener);
        
        // Send to content.js
        window.postMessage({ type: 'OPENCLAW_NETWORK_LOG', data: requestData }, '*');
        
        // Failsafe: if agent takes longer than 30s, give up and forward to not break the site
        setTimeout(() => {
            window.removeEventListener('message', listener);
            resolve({ action: 'forward' });
        }, 30000);
    });
}

// ----------------------------------------------------------------------
// Intercept FETCH
// ----------------------------------------------------------------------
const origFetch = window.fetch;
window.fetch = async function(...args) {
    let reqUrl, reqMethod, reqBody, reqHeaders = {};
    
    // Parse the fetch arguments
    if (args[0] instanceof Request) {
        reqUrl = args[0].url;
        reqMethod = args[0].method || 'GET';
        reqBody = '[Request Object]';
        try { reqHeaders = Object.fromEntries([...args[0].headers]); } catch(e) {}
    } else {
        reqUrl = args[0];
        reqMethod = args[1]?.method || 'GET';
        reqBody = args[1]?.body;
        
        if (args[1]?.headers) {
            if (args[1].headers instanceof Headers) {
                try { reqHeaders = Object.fromEntries([...args[1].headers]); } catch(e) {}
            } else {
                reqHeaders = args[1].headers; // Plain object
            }
        }
        
        if (typeof reqBody !== 'string' && reqBody !== undefined) {
            try { reqBody = JSON.stringify(reqBody); } catch(e) { reqBody = '[Complex Body]'; }
        }
    }

    // 1. Send to Agent & Wait for decision
    const agentDecision = await askAgentAndWait({
        url: reqUrl,
        method: reqMethod,
        requestHeaders: reqHeaders,
        requestBody: reqBody || null,
        timestamp: Date.now()
    });

    // 2. Execute Agent's Decision
    if (agentDecision.action === 'drop') {
        throw new TypeError('Failed to fetch: Blocked by OpenClaw AI Interceptor');
    }

    let finalArgs = [...args];
    if (agentDecision.action === 'modify') {
        let options = finalArgs[1] || {};
        if (agentDecision.requestBody !== undefined) options.body = agentDecision.requestBody;
        if (agentDecision.requestHeaders !== undefined) options.headers = agentDecision.requestHeaders;
        finalArgs[1] = options;
    }

    // 3. Send actual modified request
    return origFetch.apply(this, finalArgs);
};

// ----------------------------------------------------------------------
// Intercept XHR (XMLHttpRequest)
// ----------------------------------------------------------------------
const origXHR = window.XMLHttpRequest;
window.XMLHttpRequest = function() {
    const xhr = new origXHR();
    const origOpen = xhr.open;
    const origSend = xhr.send;
    const origSetRequestHeader = xhr.setRequestHeader;
    
    let reqMethod, reqUrl;
    let reqHeaders = {};

    xhr.open = function(method, url) {
        reqMethod = method;
        reqUrl = new URL(url, window.location.href).href;
        return origOpen.apply(this, arguments);
    };

    xhr.setRequestHeader = function(header, value) {
        reqHeaders[header] = value;
        return origSetRequestHeader.apply(this, arguments);
    };

    xhr.send = async function(body) {
        let reqBody = body;
        if (typeof reqBody !== 'string' && reqBody !== undefined && reqBody !== null) {
            try { reqBody = JSON.stringify(reqBody); } 
            catch(e) { reqBody = '[Complex Body]'; }
        }

        // 1. Send to Agent & Wait
        const agentDecision = await askAgentAndWait({
            url: reqUrl,
            method: reqMethod,
            requestHeaders: reqHeaders,
            requestBody: reqBody || null,
            timestamp: Date.now()
        });

        // 2. Execute Agent's Decision
        if (agentDecision.action === 'drop') {
            // Drop request by simply not calling origSend
            xhr.dispatchEvent(new Event('error'));
            return;
        }

        let finalBody = body;
        if (agentDecision.action === 'modify') {
            if (agentDecision.requestHeaders) {
                // Apply new headers
                for (const [k, v] of Object.entries(agentDecision.requestHeaders)) {
                    origSetRequestHeader.call(this, k, v);
                }
            }
            if (agentDecision.requestBody !== undefined) {
                finalBody = agentDecision.requestBody;
            }
        }

        // 3. Send actual request
        return origSend.call(this, finalBody);
    };
    return xhr;
};