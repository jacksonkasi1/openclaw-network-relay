# OpenClaw Network Relay - Changelog

All notable changes to this project will be documented in this file.

---

## [2026-04-19] - Zero-Latency Rules Fix & Enhanced Logging

### Fixed
- **Critical Bug: Rules not syncing** - The `syncRules()` function was returning early when `isSecureEndpoint(state.endpoint)` failed, preventing rules from being loaded from the MCP server.
  - Added fallback to `DEFAULT_ENDPOINT` (`http://127.0.0.1:31337/log`) if the stored endpoint is invalid
  - Removed the early return that was blocking rule synchronization
  - Rules now sync properly every 2 seconds when a tab is attached

- **Rules sync timing** - Added `startRuleSync()` call immediately on extension load (not just when tab is attached). This ensures rules are ready before any interception happens.

### Added
- **`DEBUG_RULES` flag** - New constant at the top of `background.js` to control verbose logging
  - Set to `true` for development/debugging
  - Set to `false` for production (reduces console noise)
  - Verbose logs (every request details) respect this flag
  - Important logs (rule matches, syncs, errors) always show

- **Comprehensive Logging System**:
  - `syncRules()` - Logs when rules are synced from MCP server
  - `evaluateRules()` - Logs when a rule matches (once warning if no rules)
  - `attachToTab()` - Logs when a tab is attached
  - `handleResponsePause()` - Logs rule state before evaluation
  - `isSecureEndpoint()` - Logs when validation fails (DEBUG only)

### Changed
- **`syncRules()` function** - Complete rewrite:
  - Fallback to default endpoint if current endpoint is invalid
  - Logs rule count on every sync
  - Better error handling with visible error messages

- **`evaluateRules()` function** - Improved:
  - Only logs "no rules loaded" warning once (not every request)
  - Resets warning when rules become available
  - Uses `DEBUG_RULES` flag for match details

- **Removed misleading comment** in `attachToTab()` that referenced non-existent code

### Files Modified

| File | Changes |
|------|---------|
| `extensions/openclaw-network-relay/background.js` | Added DEBUG_RULES flag, fixed syncRules() fallback, improved logging, added early rule sync |
| `CHANGELOG.md` | Created this changelog file |

---

## Debug Output Examples

### When DEBUG_RULES = true:
```
[OpenClaw] Extension loaded - MCP bridge endpoint: http://127.0.0.1:31337/log
[OpenClaw] startRuleSync: enabled = false
[OpenClaw] Rules synced: 5 rules from MCP server
  [0] Rule Name 1 -> /api/endpoint
  [1] Rule Name 2 -> /api/another
[OpenClaw] Tab attached: 123 - rules syncing every 2s
[OpenClaw] Response for: https://example.com/api/endpoint
[OpenClaw] Rules in state: 5
[OpenClaw] MATCHED rule: Rule Name 1 -> https://example.com/api/endpoint
[OpenClaw] RULE APPLIED: Rule Name 1 -> https://example.com/api/endpoint
[OpenClaw] Modifying response body
[OpenClaw] Response modification complete
```

### When DEBUG_RULES = false (production):
```
[OpenClaw] Extension loaded - MCP bridge endpoint: http://127.0.0.1:31337/log
[OpenClaw] Rules synced: 5 rules from MCP server
[OpenClaw] Tab attached: 123 - rules syncing every 2s
[OpenClaw] RULE APPLIED: Rule Name 1 -> https://example.com/api/endpoint
```

---

## How to Use

1. **Reload the extension** in Chrome (`chrome://extensions` → Click Reload on OpenClaw)
2. **Open DevTools** (F12) → Console tab
3. **Attach to a tab** using the extension popup
4. **Look for logs** showing:
   - "Rules synced: X rules" - rules loaded from MCP server
   - "Tab attached" - extension is working
   - "RULE APPLIED" - a rule matched and was executed

---

## Troubleshooting

If rules are not being applied:

1. **Check Service Worker console**:
   - Go to `chrome://extensions`
   - Find OpenClaw Network Relay
   - Click "Service Worker" link to see extension logs
   - Look for "[OpenClaw] Rules synced: X rules"

2. **If you see "Rules in state: 0"**:
   - The sync failed - check the endpoint URL
   - Make sure MCP server is running on port 31337

3. **If you see "Rules synced: X rules" but rules don't match**:
   - Check the `urlPattern` in your rule matches the URL
   - Check the `method` and `phase` are correct

---

## Previous Sessions

(Add future changelog entries above this line)
