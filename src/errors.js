let current = null;
let version = 0;
const listeners = new Set();
let snapshot = { last: null, version: 0 };

function changed() {
  version++;
  snapshot = { last: current, version };
  for (const fn of listeners) fn();
}

export function setLastError(err) {
  current = err;
  changed();
}

export function clearLastError() {
  current = null;
  changed();
}

export function errorSubscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function errorGetSnapshot() {
  return snapshot;
}
