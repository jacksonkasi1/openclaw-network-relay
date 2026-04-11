# OpenClaw V2 Roadmap

These are the planned advanced capabilities to be added to the server and extension to push OpenClaw to the absolute bleeding edge of autonomous security research.

### 1. Seamless File Uploads & Downloads
- **Goal:** Enable the AI to handle file-based attack vectors (XXE, malicious SVG uploads, parsing exported CSVs).
- **Implementation:** Add `browser_upload_file` and `browser_download_file` MCP tools so the AI can seamlessly push/pull payloads between the local `/hunting` directory and the target website.

### 2. Native Cookie & JWT Session Manipulation
- **Goal:** Give the AI instant, direct access to manipulate session state without clunky JavaScript evaluations.
- **Implementation:** Add `browser_get_cookies` and `browser_set_cookies` tools. The AI can instantly extract JWTs, modify claims (e.g., privilege escalation from user to admin), and inject them back into the browser memory in 0ms.

### 3. WebSocket & GraphQL Interception
- **Goal:** Expand network visibility beyond standard HTTP/REST to capture live, real-time data streams.
- **Implementation:** Hook the Chrome Extension into `Network.webSocketFrameSent` and `Network.webSocketFrameReceived` CDP events, logging all frames to the SQLite DB for the AI to query and modify on the fly.

### 4. "Stealth Mode" (Anti-Bot Evasion)
- **Goal:** Make the CDP-controlled browser completely undetectable to advanced anti-bot firewalls (DataDome, Cloudflare Turnstile).
- **Implementation:** Automatically inject stealth evasion scripts (spoofing `navigator.webdriver`, masking CDP footprint) the exact millisecond a new document/tab opens.
