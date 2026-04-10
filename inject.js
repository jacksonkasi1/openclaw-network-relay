const origFetch = window.fetch;
window.fetch = async function(...args) {
    let reqUrl, reqMethod, reqBody, reqHeaders = {};
    
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
            try {
                reqBody = JSON.stringify(reqBody);
            } catch(e) {
                reqBody = '[Complex Body]';
            }
        }
    }

    try {
        const response = await origFetch.apply(this, args);
        const clone = response.clone();
        
        let resHeaders = {};
        if (response.headers) {
            try { resHeaders = Object.fromEntries([...response.headers]); } catch(e) {}
        }
        
        clone.text().then(text => {
            window.postMessage({
                type: 'OPENCLAW_NETWORK_LOG',
                data: {
                    url: reqUrl,
                    method: reqMethod,
                    requestHeaders: reqHeaders,
                    requestBody: reqBody || null,
                    responseHeaders: resHeaders,
                    responseBody: text,
                    timestamp: Date.now()
                }
            }, '*');
        }).catch(() => {});
        
        return response;
    } catch (error) {
        throw error;
    }
};

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

    xhr.send = function(body) {
        let reqBody = body;
        if (typeof reqBody !== 'string' && reqBody !== undefined && reqBody !== null) {
            try { reqBody = JSON.stringify(reqBody); } 
            catch(e) { reqBody = '[Complex Body]'; }
        }

        xhr.addEventListener('load', function() {
            let resBody = '';
            try {
                if (xhr.responseType === '' || xhr.responseType === 'text') {
                    resBody = xhr.responseText;
                } else if (xhr.responseType === 'json') {
                    resBody = typeof xhr.response === 'object' ? JSON.stringify(xhr.response) : xhr.response;
                } else {
                    resBody = '[Binary/Non-Text Response]';
                }
            } catch(e) { 
                resBody = '[Error Reading Response]'; 
            }

            let resHeaders = {};
            try {
                const headersStr = xhr.getAllResponseHeaders();
                if (headersStr) {
                    headersStr.trim().split(/[\r\n]+/).forEach(line => {
                        const parts = line.split(': ');
                        const header = parts.shift();
                        const value = parts.join(': ');
                        if (header) resHeaders[header.toLowerCase()] = value;
                    });
                }
            } catch(e) {}

            window.postMessage({
                type: 'OPENCLAW_NETWORK_LOG',
                data: {
                    url: reqUrl,
                    method: reqMethod,
                    requestHeaders: reqHeaders,
                    requestBody: reqBody || null,
                    responseHeaders: resHeaders,
                    responseBody: resBody,
                    timestamp: Date.now()
                }
            }, '*');
        });
        
        return origSend.apply(this, arguments);
    };
    return xhr;
};