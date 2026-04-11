# OpenClaw Network Relay & MCP Server

OpenClaw is a high-performance, "Bring Your Own Browser" (BYOB) architecture designed for autonomous AI agents (like Kilo or Cursor) to perform deep web automation, bug bounty hunting, and network interception.

By pairing a custom Chrome Extension with a blazing-fast local Bun + SQLite server, OpenClaw allows AI agents to pilot your *actual* authenticated browser sessions, completely bypassing headless bot-detection (WAFs/Cloudflare) and inheriting your live login state.

## Core Capabilities

- **Token-Optimized DOM Extraction:** A custom Markdown Accessibility (A11y) Tree walker compresses massive HTML pages into tiny, token-efficient semantic maps of interactive elements.
- **Visual Set-of-Mark (SoM):** The AI can request annotated screenshots with numbered bounding boxes over interactive elements for flawless visual reasoning.
- **Multi-Modal Browser Control:** Native MCP tools for the AI to navigate, click, type, and manage multiple tabs asynchronously using the Chrome DevTools Protocol (CDP).
- **Raw SQL Traffic Analysis:** All browser network traffic is logged to a highly-optimized SQLite database (WAL + Memory mapped). The AI can execute raw `SELECT` queries to hunt for IDORs, leaked tokens, and misconfigurations.
- **Zero-Latency Network Interception:** The AI can deploy on-the-fly rules to modify HTTP requests/responses instantly without pausing the browser.
- **Remote AI Tunneling (SSE):** Built-in Cloudflare tunneling exposes an SSE endpoint, allowing remote AIs running on a cloud VPS to control your local Mac browser securely.

## Quick Start

### 1. Start the Server
Run the local MCP server and SQLite database:
```bash
./start-server.sh
# Or manually: cd mcp-server && bun run src/index.js
```
*The dashboard will be available at `http://127.0.0.1:31337`*

### 2. Install the Chrome Extension
1. Open Chrome/Brave and go to `chrome://extensions`
2. Enable "Developer mode" in the top right.
3. Click "Load unpacked" and select this repository folder.
4. Click the OpenClaw extension icon on any tab and toggle it to **ON**.

### 3. Connect your AI
If your AI (like Kilo) is running locally, it will automatically connect via STDIO.
If your AI is running remotely, open the dashboard, enable the **Remote AI Tunnel (SSE)**, and paste the generated Cloudflare URL into your remote AI's configuration.

## AI Agent Personas
This repository includes custom agent prompts in the `.kilo/agent/` directory specifically tuned for OpenClaw:
* **Bug-Bounty-Hunter:** An autonomous, relentless hacker persona that leverages Google dorking, raw SQL queries, and multi-tab pivoting to discover and write PoCs for vulnerabilities.
* **Security-Auditor:** A defensive QA persona designed to bypass strict LLM ethical filters by framing attacks as authorized compliance testing.

## Architecture
- **mcp-server/:** Bun backend, SQLite DB, Express Dashboard, and Model Context Protocol (MCP) tool definitions.
- **background.js:** Manifest V3 service worker that bridges the Chrome extension to the Node server via a persistent `fetch` stream.
- **reports/:** (Ignored by Git) Local directory where the AI autonomously saves generated markdown Bug Bounty Proof-of-Concepts.
- **hunting/:** (Ignored by Git) Local workspace for the AI to clone repos and write temporary exploit scripts.

## Roadmap
See `PLAN.md` for upcoming advanced features.
