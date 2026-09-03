import { stat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { consoleEmit } from './console.js';
import { setLastError } from './errors.js';

const decoder = new TextDecoder();

export async function fileExists(p) {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

export async function dirExists(p) {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

export async function logSize(cfg) {
  try {
    return (await stat(cfg.logFile)).size;
  } catch {
    return 0;
  }
}

function lineSplitter(onLine) {
  let buf = '';
  return (text, flush = false) => {
    buf += text;
    const parts = buf.split(/\r?\n/);
    buf = parts.pop();
    for (const part of parts) {
      const line = part.replace(/\r$/, '');
      if (line) onLine(line);
    }
    if (flush && buf) {
      const tail = buf.replace(/\r$/, '');
      if (tail) onLine(tail);
      buf = '';
    }
  };
}

export async function runProc(exe, args, opts = {}) {
  const { cwd, env, quiet = false } = opts;
  if (!quiet) {
    consoleEmit('cmd', `${exe} ${args.join(' ')}`);
  }
  const proc = Bun.spawn([exe, ...args], {
    cwd,
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  let stdout = '';
  let stderr = '';

  const outSplit = lineSplitter((l) => {
    if (!quiet) consoleEmit('out', l);
  });
  const errSplit = lineSplitter((l) => {
    if (!quiet) consoleEmit('err', l);
  });

  const drain = async (stream, split, isErr) => {
    try {
      for await (const chunk of stream) {
        const text = typeof chunk === 'string' ? chunk : decoder.decode(chunk);
        if (isErr) stderr += text;
        else stdout += text;
        split(text);
      }
    } catch {
      // stream closed early
    }
    split('', true);
  };

  await Promise.all([drain(proc.stdout, outSplit, false), drain(proc.stderr, errSplit, true)]);
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

export async function runPsql(cfg, sql, extra = []) {
  const { stdout, exitCode } = await runProc(
    cfg.psql,
    ['-h', cfg.db.host, '-p', String(cfg.db.port), '-U', cfg.db.user, '-d', cfg.db.name, '-t', '-A', '-F', '|', '-c', sql, ...extra],
    { env: { PGPASSWORD: cfg.db.password }, quiet: true },
  );
  return { rows: stdout.split('\n').map((s) => s.trim()).filter(Boolean), exitCode };
}

async function runPowerShell(script) {
  const { stdout, exitCode } = await runProc(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { quiet: true },
  );
  return { out: stdout.trim(), exitCode };
}

export async function isAdmin() {
  const script =
    "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)";
  const { out } = await runPowerShell(script);
  return out === 'True';
}

export function sqlQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

export async function serviceStatus(cfg) {
  const script = `(Get-Service -Name ${sqlQuote(cfg.service)} -ErrorAction SilentlyContinue).Status`;
  const { out } = await runPowerShell(script);
  if (out === 'Running') return 'running';
  if (out === 'Stopped') return 'stopped';
  return 'unknown';
}

async function setService(cfg, action) {
  const verb = action === 'start' ? 'Start-Service' : 'Stop-Service';
  const script = `${verb} -Name ${sqlQuote(cfg.service)} -ErrorAction Stop`;
  const { exitCode, out } = await runPowerShell(script);
  if (exitCode !== 0) {
    throw new Error(`${verb} failed (${exitCode}). Are you running as Administrator? ${out}`);
  }
}

export async function ensureService(cfg, wantRunning) {
  const target = wantRunning ? 'running' : 'stopped';
  const current = await serviceStatus(cfg);
  if (current === target) return;
  if (current === 'unknown') {
    throw new Error(`Service ${cfg.service} not found or not reachable.`);
  }
  consoleEmit('sys', `${wantRunning ? 'starting' : 'stopping'} service ${cfg.service}...`);
  await setService(cfg, wantRunning ? 'start' : 'stop');
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 700));
    if ((await serviceStatus(cfg)) === target) {
      consoleEmit('ok', `service ${wantRunning ? 'running' : 'stopped'}.`);
      return;
    }
  }
  throw new Error(`Service did not reach '${target}' state in time.`);
}

export async function dbReachable(cfg) {
  if (!(await fileExists(cfg.psql))) return false;
  const { stdout } = await runProc(
    cfg.psql,
    ['-h', cfg.db.host, '-p', String(cfg.db.port), '-U', cfg.db.user, '-d', cfg.db.name, '-t', '-A', '-c', 'SELECT 1'],
    { env: { PGPASSWORD: cfg.db.password }, quiet: true },
  );
  return stdout.trim() === '1';
}

export function sourceDirs(cfg) {
  return String(cfg.srcDirs || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function findModuleDir(cfg, name) {
  for (const root of sourceDirs(cfg)) {
    const dir = join(root, name);
    if ((await dirExists(dir)) && (await fileExists(join(dir, '__manifest__.py')))) return dir;
  }
  return null;
}

export async function listRepoModules(cfg) {
  const seen = new Set();
  for (const root of sourceDirs(cfg)) {
    if (!(await dirExists(root))) continue;
    const entries = await readdir(root, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (seen.has(e.name)) continue;
      if (await fileExists(join(root, e.name, '__manifest__.py'))) seen.add(e.name);
    }
  }
  return [...seen].sort();
}

export async function readDbModuleStates(cfg, names) {
  if (!names.length) return {};
  const inList = names.map((n) => sqlQuote(n)).join(',');
  const { rows } = await runPsql(cfg, `SELECT name || '|' || state FROM ir_module_module WHERE name IN (${inList})`);
  const map = {};
  for (const row of rows) {
    const idx = row.indexOf('|');
    if (idx >= 0) map[row.slice(0, idx)] = row.slice(idx + 1);
  }
  return map;
}

export async function parseManifestDepends(manifestPath) {
  try {
    const raw = await readFile(manifestPath, 'utf8');
    const m = raw.match(/['"]depends['"]\s*:\s*\[([^\]]*)\]/);
    if (!m) return [];
    const re = /['"]([^'"]+)['"]/g;
    const deps = [];
    let hit;
    while ((hit = re.exec(m[1])) !== null) deps.push(hit[1]);
    return deps;
  } catch {
    return [];
  }
}

export async function expandDeps(cfg, names) {
  const seen = new Set(names);
  const queue = [...names];
  const extra = new Set();
  while (queue.length) {
    const name = queue.shift();
    const dir = await findModuleDir(cfg, name);
    if (!dir) continue;
    const deps = await parseManifestDepends(join(dir, '__manifest__.py'));
    for (const dep of deps) {
      if (seen.has(dep)) continue;
      seen.add(dep);
      if (await findModuleDir(cfg, dep)) {
        extra.add(dep);
        queue.push(dep);
      }
    }
  }
  return [...extra];
}

function robocopyFlags() {
  return ['/E', '/R:1', '/W:1', '/NJH', '/NFL', '/NDL', '/NP'];
}

export async function robocopy(cfg, source, target, quiet = true) {
  const { exitCode } = await runProc('robocopy.exe', [source, target, ...robocopyFlags()], { quiet });
  if (exitCode >= 8) {
    throw new Error(`robocopy failed (exit code ${exitCode}) for:\n  ${source}\n  -> ${target}`);
  }
  return exitCode;
}

export async function copySelected(cfg, modules) {
  const list = [...new Set(modules)];
  if (!list.length) {
    consoleEmit('warn', 'no modules to copy.');
    return [];
  }
  const missing = [];
  const copied = [];
  consoleEmit('sys', `copying ${list.length} module(s) into addons path...`);
  for (const m of list) {
    const src = await findModuleDir(cfg, m);
    if (!src) {
      missing.push(m);
      continue;
    }
    await robocopy(cfg, src, join(cfg.destAddons, m));
    copied.push(m);
  }
  if (copied.length) consoleEmit('ok', `copied ${copied.length} module(s): ${copied.join(', ')}`);
  if (missing.length) consoleEmit('warn', `not found in any source dir, skipped: ${missing.join(', ')}`);
  return copied;
}

export async function syncAll(cfg) {
  const modules = await listRepoModules(cfg);
  if (!modules.length) {
    throw new Error('No modules found. Check "Module source dirs (csv)" in settings.');
  }
  await copySelected(cfg, modules);
}

export async function runOdooCli(cfg, flag, modules) {
  if (!(await fileExists(cfg.python))) throw new Error(`python not found: ${cfg.python}`);
  if (!(await fileExists(cfg.odooBin))) throw new Error(`odoo-bin not found: ${cfg.odooBin}`);
  if (!(await fileExists(cfg.odooConf))) throw new Error(`odoo.conf not found: ${cfg.odooConf}`);
  const label = flag === '-u' ? 'upgrade' : 'install';
  consoleEmit('sys', `odoo ${label}: ${modules.join(', ')}`);
  const { exitCode } = await runProc(cfg.python, [cfg.odooBin, '-c', cfg.odooConf, '-d', cfg.db.name, flag, modules.join(','), '--stop-after-init']);
  if (exitCode !== 0) {
    throw new Error(`odoo ${label} exited with code ${exitCode}`);
  }
  consoleEmit('ok', `odoo ${label} finished.`);
}

export async function applyModules(cfg, opts) {
  const { kind, modules, alsoCopy } = opts;
  if (!modules.length) {
    consoleEmit('warn', 'no modules selected.');
    return;
  }
  if (kind === 'install') {
    const extra = await expandDeps(cfg, modules);
    if (extra.length) consoleEmit('sys', `dependency closure from manifests: +${extra.join(', ')}`);
    await copySelected(cfg, [...modules, ...extra]);
  } else if (alsoCopy) {
    await copySelected(cfg, modules);
  }

  const wasRunning = (await serviceStatus(cfg)) === 'running';
  let tailer;
  let fromOffset = 0;
  try {
    if (wasRunning) await ensureService(cfg, false);
    fromOffset = await logSize(cfg);
    tailer = startLogTail(cfg, (line) => consoleEmit('log', line), 400);
    await runOdooCli(cfg, kind === 'install' ? '-i' : '-u', modules);
  } catch (e) {
    let lines;
    if (fromOffset > 0) {
      const res = await tailLog(cfg, fromOffset);
      lines = res.lines;
    } else {
      lines = await initialLogLines(cfg, 150);
    }
    const verb = kind === 'install' ? 'install' : 'upgrade';
    const code = e && e.message ? e.message : String(e);
    const text = [
      `command : odoo ${verb} ${modules.join(', ')}`,
      `status  : ${code}`,
      `time    : ${new Date().toLocaleString()}`,
      '',
      ...lines.slice(-500),
    ].join('\n');
    setLastError({ label: `odoo ${verb} failed`, code, text });
    consoleEmit('err', `odoo ${verb} failed: ${code}`);
    consoleEmit('err', 'full traceback captured — open the error view (e) and copy it (c).');
    throw e;
  } finally {
    if (tailer) tailer.stop();
    if (wasRunning) await ensureService(cfg, true);
  }
}

export async function resetStuckModuleStates(cfg) {
  consoleEmit('sys', 'resetting transient module states (to install/upgrade/remove)...');
  await runPsql(cfg, "UPDATE ir_module_module SET state='installed' WHERE state IN ('to remove','to upgrade')");
  await runPsql(cfg, "UPDATE ir_module_module SET state='uninstalled' WHERE state='to install'");
  const { rows } = await runPsql(cfg, "SELECT count(*) FROM ir_module_module WHERE state IN ('to install','to upgrade','to remove')");
  const left = rows[0] ?? '0';
  if (left === '0') consoleEmit('ok', 'no stuck module states remaining.');
  else consoleEmit('warn', `${left} module state(s) still pending — re-run if needed.`);
}

export async function restartService(cfg) {
  const current = await serviceStatus(cfg);
  if (current === 'unknown') throw new Error(`Service ${cfg.service} not found.`);
  await ensureService(cfg, false);
  await ensureService(cfg, true);
  consoleEmit('ok', 'service restarted.');
}

export async function copyToClipboard(text) {
  try {
    const proc = Bun.spawn(['clip.exe'], { stdin: 'pipe', stdout: 'ignore', stderr: 'ignore' });
    proc.stdin.write(text);
    await proc.stdin.end();
    const code = await proc.exited;
    return code === 0;
  } catch {
    return false;
  }
}

export async function tailLog(cfg, offset) {
  let size = 0;
  try {
    size = (await stat(cfg.logFile)).size;
  } catch {
    return { lines: [], next: offset };
  }
  if (size < offset) offset = 0;
  if (size === offset) return { lines: [], next: offset };
  const buf = await Bun.file(cfg.logFile).slice(offset, size).arrayBuffer();
  const text = decoder.decode(buf);
  const nl = text.lastIndexOf('\n');
  if (nl < 0) return { lines: [], next: offset };
  const head = text.slice(0, nl);
  const lines = head.split(/\r?\n/).map((l) => l.replace(/\r$/, ''));
  return { lines, next: offset + nl + 1 };
}

export async function initialLogLines(cfg, count = 60) {
  let size = 0;
  try {
    size = (await stat(cfg.logFile)).size;
  } catch {
    return [];
  }
  if (!size) return [];
  const start = Math.max(0, size - 65536);
  const buf = await Bun.file(cfg.logFile).slice(start, size).arrayBuffer();
  const text = decoder.decode(buf);
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\r$/, ''));
  return lines.filter((l) => l.length > 0).slice(-count);
}

export function startLogTail(cfg, onLines, every = 500) {
  let offset = 0;
  let timer = null;
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const { lines, next } = await tailLog(cfg, offset);
      offset = next;
      if (lines.length) onLines(lines);
    } catch {
      // transient read errors are ignored
    }
  };
  (async () => {
    try {
      offset = (await stat(cfg.logFile)).size;
    } catch {
      offset = 0;
    }
    if (stopped) return;
    timer = setInterval(tick, every);
    tick();
  })();
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      if (timer) clearInterval(timer);
    },
  };
}

export async function probe(cfg) {
  const checks = [];
  const fileKeys = [
    { key: 'python', label: 'Python' },
    { key: 'odooBin', label: 'odoo-bin' },
    { key: 'odooConf', label: 'odoo.conf' },
    { key: 'logFile', label: 'Log file' },
    { key: 'psql', label: 'psql.exe' },
  ];
  for (const k of fileKeys) checks.push({ key: k.key, label: k.label, ok: await fileExists(cfg[k.key]) });
  checks.push({ key: 'destAddons', label: 'Addons dir', ok: await dirExists(cfg.destAddons) });

  const dirs = sourceDirs(cfg);
  const dirOk = [];
  for (const d of dirs) dirOk.push(await dirExists(d));
  const allSourcesOk = dirs.length > 0 && dirOk.every(Boolean);
  checks.push({
    label: 'Module sources',
    ok: allSourcesOk,
    extra: dirs.length ? `${dirOk.filter(Boolean).length}/${dirs.length} ok` : 'none configured',
  });

  const [admin, service, dbOk] = await Promise.all([isAdmin(), serviceStatus(cfg), dbReachable(cfg)]);
  const modules = await listRepoModules(cfg);
  let states = {};
  if (dbOk && modules.length) {
    try {
      states = await readDbModuleStates(cfg, modules);
    } catch {
      states = {};
    }
  }
  return { paths: checks, admin, service, dbOk, modules, states, srcCount: dirs.length };
}
