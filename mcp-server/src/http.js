import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createPendingIntercept, dropPendingIntercept, markTimedOut } from './state.js';
import { getActiveRules, getAllRules, addTrafficLog, getTrafficLogs, updateRuleState, updateRule, removeRule, clearAllTrafficLogs, clearAllRules } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicPath = path.resolve(__dirname, '../public');

const DEFAULT_TIMEOUT_MS = 20000;

global.sseEnabled = false;

function fallbackDecisionForPhase(phase) {
  return { action: 'forward' };
}

export function createHttpApp() {
  const app = express();

  app.use(cors({ origin: ['http://127.0.0.1:31337', 'http://localhost:31337'] }));
  app.use(express.json({ limit: '50mb' }));
  app.use(express.static(publicPath)); // Serve the web dashboard

  // SSE Remote AI Settings
  app.get('/api/settings', (_req, res) => res.json({ sseEnabled: global.sseEnabled }));
  app.post('/api/settings/sse', (req, res) => {
    global.sseEnabled = !!req.body.enabled;
    res.json({ ok: true, sseEnabled: global.sseEnabled });
  });

  // Health and Rule sync endpoints for the Chrome Extension
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.get('/rules', (_req, res) => res.json(getActiveRules()));

  // Internal API for the Web Dashboard
  app.get('/api/rules', (_req, res) => res.json(getAllRules()));
  app.get('/api/logs', (_req, res) => res.json(getTrafficLogs()));
  app.put('/api/rules/:id', (req, res) => {
    updateRule(req.params.id, req.body);
    res.json({ ok: true });
  });
  app.post('/api/rules/:id/toggle', (req, res) => {
    updateRuleState(req.params.id, req.body.isActive);
    res.json({ ok: true });
  });
  app.delete('/api/rules/:id', (req, res) => {
    removeRule(req.params.id);
    res.json({ ok: true });
  });
  app.delete('/api/rules', (_req, res) => {
    clearAllRules();
    res.json({ ok: true });
  });
  app.delete('/api/logs', (_req, res) => {
    clearAllTrafficLogs();
    res.json({ ok: true });
  });

  // The main endpoint the extension hits for traffic
  app.post('/log', (req, res) => {
    const interceptData = req.body;
    const interceptId = interceptData?.id;

    if (!interceptId) {
      res.status(400).json({ error: 'Missing intercept ID' });
      return;
    }

    addTrafficLog(interceptData); // Store persistently in SQLite

    // If extension is purely listening or already applied a rule locally, just return forward immediately
    if (interceptData.mode === 'listen' || interceptData.appliedRule) {
      res.json({ action: 'forward' });
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
        if (!res.writableEnded) res.json(decision);
      })
      .catch(() => {
        if (!res.writableEnded) res.json(fallbackDecision);
      });
  });

  return app;
}