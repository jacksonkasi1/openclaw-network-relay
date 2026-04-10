import { getTrafficLogs } from './src/db.js';

function serializeIntercept(intercept) {
  return {
    id: intercept.id,
    phase: intercept.data?.phase || intercept.phase,
    tabId: intercept.data?.tabId || intercept.tabId,
    resourceType: intercept.data?.resourceType || intercept.resourceType,
    url: intercept.data?.url || intercept.url,
    method: intercept.data?.method || intercept.method,
    requestHeaders: intercept.data?.requestHeaders || intercept.requestHeaders,
    requestBody: intercept.data?.requestBody || intercept.requestBody,
    responseStatusCode: intercept.data?.responseStatusCode || intercept.responseStatusCode,
    responseStatusText: intercept.data?.responseStatusText || intercept.responseStatusText,
    responseHeaders: intercept.data?.responseHeaders || intercept.responseHeaders,
    responseBody: intercept.data?.responseBody || intercept.responseBody,
    createdAt: new Date(intercept.createdAt || intercept.timestamp).toISOString(),
    folder: intercept.data?.folder || intercept.folder
  };
}

try {
  console.log("Logs:", getTrafficLogs(5).map(serializeIntercept));
} catch (e) {
  console.error("Error:", e);
}
