import express from 'express';
import cors from 'cors';
import { pendingRequests } from './state.js';

export function startHttpServer(port = 31337) {
    const app = express();
    app.use(cors());
    app.use(express.json({ limit: '50mb' }));

    app.post('/log', (req, res) => {
        const requestData = req.body;
        const { id } = requestData;

        if (!id) {
            return res.status(400).json({ error: 'Missing request ID' });
        }

        // Create a deferred promise that the MCP agent will resolve
        const deferred = {};
        deferred.promise = new Promise((resolve, reject) => {
            deferred.resolve = resolve;
            deferred.reject = reject;
        });

        // Store request in state for the agent to read
        pendingRequests.set(id, {
            data: requestData,
            timestamp: Date.now(),
            deferred
        });

        // Wait for the AI agent to make a decision
        deferred.promise.then(actionResult => {
            res.json(actionResult); // Returns { action: 'modify' | 'forward' | 'drop', ... }
            pendingRequests.delete(id);
        }).catch(err => {
            res.json({ action: 'forward' });
            pendingRequests.delete(id);
        });

        // Auto-forward if the agent takes too long (25s) so the user's browser doesn't freeze permanently
        setTimeout(() => {
            if (pendingRequests.has(id)) {
                deferred.resolve({ action: 'forward' });
            }
        }, 25000);
    });

    app.listen(port, () => {
        console.error(`[HTTP] Webhook listener running on port ${port} (Ready for browser traffic)`);
    });
}