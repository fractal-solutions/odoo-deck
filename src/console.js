const MAX = 5000;

export const KIND_COLORS = {
  cmd: 'gray',
  out: 'white',
  err: 'red',
  ok: 'green',
  warn: 'yellow',
  sys: 'magenta',
  log: 'dim',
};

export const KIND_MARK = {
  cmd: '> ',
  out: '  ',
  err: '[ERR] ',
  ok: '[OK] ',
  warn: '[WARN] ',
  sys: '* ',
  log: '  ',
};

let entries = [];
let version = 0;
const listeners = new Set();
let snapshot = { entries, version: 0 };

function changed() {
  version++;
  snapshot = { entries, version };
  for (const fn of listeners) fn();
}

export function consoleEmit(kind, text) {
  const line = String(text).replace(/\s+$/g, '');
  entries.push({ kind, text: line });
  if (entries.length > MAX) entries = entries.slice(entries.length - MAX);
  changed();
}

export function clearConsole() {
  entries = [];
  changed();
}

export function consoleSubscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function consoleGetSnapshot() {
  return snapshot;
}
