import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { pendingRequests } from './state.js';

export function startMcpServer() {
    const server = new Server(
        { name: "openclaw-burpsuite-agent", version: "1.0.0" },
        { capabilities: { tools: {} } }
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => {
        return {
            tools: [
                {
                    name: "get_pending_requests",
                    description: "List all intercepted HTTP requests waiting for your decision. Returns the ID, URL, Method, Headers, and Body.",
                    inputSchema: { type: "object", properties: {} }
                },
                {
                    name: "resolve_request",
                    description: "Decide the fate of an intercepted HTTP request. You can forward it, drop it, or modify its payload/headers before sending it to the real server.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            id: { type: "string", description: "The ID of the pending request" },
                            action: { type: "string", enum: ["forward", "drop", "modify"], description: "What to do with the request" },
                            modifiedBody: { type: "string", description: "If action is 'modify', provide the new stringified body" },
                            modifiedHeaders: { type: "object", description: "If action is 'modify', provide the new headers object" }
                        },
                        required: ["id", "action"]
                    }
                }
            ]
        };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        if (request.params.name === "get_pending_requests") {
            const requests = Array.from(pendingRequests.entries()).map(([id, item]) => ({
                id,
                url: item.data.url,
                method: item.data.method,
                headers: item.data.requestHeaders,
                body: item.data.requestBody,
                waitingSince: new Date(item.timestamp).toISOString()
            }));
            
            if (requests.length === 0) {
                return { content: [{ type: "text", text: "No pending requests at the moment." }] };
            }
            
            return { content: [{ type: "text", text: JSON.stringify(requests, null, 2) }] };
        }

        if (request.params.name === "resolve_request") {
            const { id, action, modifiedBody, modifiedHeaders } = request.params.arguments;
            
            if (!pendingRequests.has(id)) {
                return { isError: true, content: [{ type: "text", text: `Request ID ${id} not found or already resolved (might have timed out).` }] };
            }

            const item = pendingRequests.get(id);
            item.deferred.resolve({
                action,
                requestBody: modifiedBody,
                requestHeaders: modifiedHeaders
            });

            return { content: [{ type: "text", text: `Successfully resolved request ${id} with action: ${action}` }] };
        }

        throw new Error(`Tool not found: ${request.params.name}`);
    });

    const transport = new StdioServerTransport();
    server.connect(transport).then(() => {
        console.error("[MCP] AI Agent connection active on STDIO");
    });
}