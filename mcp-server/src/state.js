const pendingIntercepts = new Map();

export function listPendingIntercepts() {
  return Array.from(pendingIntercepts.values()).sort((left, right) => left.createdAt - right.createdAt);
}

export function getPendingIntercept(id) {
  return pendingIntercepts.get(id) || null;
}

export function createPendingIntercept(data) {
  const intercept = {
    id: data.id,
    data,
    createdAt: Date.now(),
    status: "pending",
    resolve: null,
    reject: null,
    timeoutId: null,
  };

  intercept.promise = new Promise((resolve, reject) => {
    intercept.resolve = resolve;
    intercept.reject = reject;
  });

  pendingIntercepts.set(intercept.id, intercept);
  return intercept;
}

export function markTimedOut(id, fallbackResult) {
  const intercept = pendingIntercepts.get(id);

  if (!intercept || intercept.status !== "pending") {
    return false;
  }

  intercept.status = "timed_out";
  clearTimeout(intercept.timeoutId);
  pendingIntercepts.delete(id);
  intercept.resolve(fallbackResult);
  return true;
}

export function resolvePendingIntercept(id, result) {
  const intercept = pendingIntercepts.get(id);

  if (!intercept || intercept.status !== "pending") {
    return false;
  }

  intercept.status = "resolved";
  clearTimeout(intercept.timeoutId);
  pendingIntercepts.delete(id);
  intercept.resolve(result);
  return true;
}

export function rejectPendingIntercept(id, error) {
  const intercept = pendingIntercepts.get(id);

  if (!intercept || intercept.status !== "pending") {
    return false;
  }

  intercept.status = "rejected";
  clearTimeout(intercept.timeoutId);
  pendingIntercepts.delete(id);
  intercept.reject(error);
  return true;
}

export function dropPendingIntercept(id) {
  const intercept = pendingIntercepts.get(id);

  if (!intercept) {
    return false;
  }

  clearTimeout(intercept.timeoutId);
  pendingIntercepts.delete(id);
  return true;
}
