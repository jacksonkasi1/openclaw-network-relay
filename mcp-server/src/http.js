import express from 'express';
import cors from 'cors';
import { createPendingIntercept, dropPendingIntercept, markTimedOut } from './state.js';

const DEFAULT_TIMEOUT_MS = 20000;

function fallbackDecisionForPhase(phase) {
  if (phase === 'response') {
    return { action: 'forward' };
  }

  return { action: 'forward' };
}

export function startHttpServer(port = 31337) {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.post('/log', (req, res) => {
    const interceptData = req.body;
    const interceptId = interceptData?.id;

    if (!interceptId) {
      res.status(400).json({ error: 'Missing intercept ID' });
      return;
    }

    const intercept = createPendingIntercept(interceptData);
    const fallbackDecision = fallbackDecisionForPhase(interceptData.phase);

    intercept.timeoutId = setTimeout(() => {
      markTimedOut(interceptId, fallbackDecision);
    }, DEFAULT_TIMEOUT_MS);

    req.on('close', () => {
      if (!res.writableEnded) {
        dropPendingIntercept(interceptId);
      }
    });

    intercept.promise
      .then((decision) => {
        if (!res.writableEnded) {
          res.json(decision);
        }
      })
      .catch(() => {
        if (!res.writableEnded) {
          res.json(fallbackDecision);
        }
      });
  });

  app.listen(port, () => {
    console.error(`[HTTP] MCP bridge listening on port ${port}`);
  });
}
