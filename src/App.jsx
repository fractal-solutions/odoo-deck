import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { CONFIG_PATH, FIELD_DEFS, getPath, loadConfig, saveConfig, setPath } from './config.js';
import {
  consoleGetSnapshot,
  consoleSubscribe,
  consoleEmit,
  clearConsole,
  KIND_COLORS,
  KIND_MARK,
} from './console.js';
import { errorGetSnapshot, errorSubscribe, clearLastError, setLastError } from './errors.js';
import {
  probe,
  syncAll,
  applyModules,
  restartService,
  resetStuckModuleStates,
  copyToClipboard,
  startLogTail,
  cloneDatabase,
  validateCloneDatabaseName,
} from './odoo.js';

const INSTALLED_STATES = ['installed', 'to upgrade', 'to install'];
const FRAMES = ['-', '\\', '|', '/'];

const C = {
  brand: 'magenta',
  accent: 'cyan',
  ok: 'green',
  bad: 'red',
  warn: 'yellow',
  dim: 'gray',
  selBg: '#3b82f6',
  selFg: '#ffffff',
};

function useConsole() {
  const snap = React.useSyncExternalStore(consoleSubscribe, consoleGetSnapshot);
  return snap.entries;
}

function useError() {
  const snap = React.useSyncExternalStore(errorSubscribe, errorGetSnapshot);
  return snap.last;
}

function Spinner({ label }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((v) => (v + 1) % FRAMES.length), 80);
    return () => clearInterval(t);
  }, []);
  return (
    <Text color={C.accent} bold>
      {FRAMES[i]} {label}
    </Text>
  );
}

function Header({ cfg, status, busy, label }) {
  const svc = status ? status.service : '?';
  const svcColor = svc === 'running' ? C.ok : svc === 'stopped' ? C.warn : C.bad;
  const dbColor = status && status.dbOk ? C.ok : C.bad;
  const whoColor = status ? (status.admin ? C.ok : C.warn) : C.dim;
  const whoText = status ? (status.admin ? 'ADMIN' : 'USER') : '?';
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={C.brand} paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold color={C.brand}>
          [ ODOO-DECK ]
        </Text>
        <Text dim>local odoo command center</Text>
      </Box>
      <Box justifyContent="space-between" marginTop={1}>
        <Box>
          <Text color={svcColor} bold>
            {svc.toUpperCase()}
          </Text>
          <Text dim> db </Text>
          <Text bold color={dbColor}>
            {cfg.db.name}
          </Text>
          <Text dim> | who </Text>
          <Text color={whoColor} bold>
            {whoText}
          </Text>
          {status ? (
            <Text dim>
              {' '}
              | {status.modules.length} modules in sources
            </Text>
          ) : null}
        </Box>
        {busy ? (
          <Box>
            <Spinner label={busy} />
          </Box>
        ) : (
          <Text dim>{label}</Text>
        )}
      </Box>
    </Box>
  );
}

function Tabs({ active, hasError }) {
  const tabs = [
    { id: 'home', label: 'Home  1' },
    { id: 'logs', label: 'Logs  2' },
    { id: 'settings', label: 'Settings  3' },
  ];
  if (hasError) tabs.push({ id: 'error', label: 'Error  e', bad: true });
  return (
    <Box>
      {tabs.map((t) => {
        const on = active === t.id;
        return (
          <Box key={t.id} marginRight={1}>
            {on ? (
              <Box backgroundColor={C.selBg} paddingX={1}>
                <Text color="black" bold>
                  [ {t.label} ]
                </Text>
              </Box>
            ) : (
              <Text color={t.bad ? C.bad : C.dim}>  {t.label}  </Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

function Pane({ title, color = 'gray', rows, children }) {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={color} height={rows} paddingX={1}>
      {title ? (
        <Text color={color} bold>
          {title}
        </Text>
      ) : null}
      {children}
    </Box>
  );
}

function Menu({ items, index, width }) {
  return (
    <Box flexDirection="column">
      {items.map((it, i) => {
        const active = i === index;
        const tag = it.tag ? `  (${it.tag})` : '';
        const prefix = active ? '> ' : '  ';
        const text = `${prefix}${it.label}${tag}`.padEnd(width).slice(0, width);
        return (
          <Text key={it.id} bold={active} color={active ? C.accent : it.disabled ? C.dim : 'white'}>
            {text}
          </Text>
        );
      })}
    </Box>
  );
}

function Health({ status, width }) {
  const rows = [];
  const push = (t, v, c) => rows.push({ text: `${t.padEnd(18)}${v}`.padEnd(width).slice(0, width), c });
  if (status) {
    push('service', status.service, status.service === 'running' ? C.ok : status.service === 'stopped' ? C.warn : C.bad);
    push('database', status.dbOk ? 'reachable' : 'unreachable', status.dbOk ? C.ok : C.bad);
    push('admin', status.admin ? 'yes' : 'run elevated', status.admin ? C.ok : C.warn);
    push('modules', `${status.modules.length} in sources`, C.accent);
    const src = status.paths.find((p) => p.label === 'Module sources');
    push('source dirs', src ? src.extra : 'none configured', src && src.ok ? C.dim : C.bad);
    for (const p of status.paths) {
      if (!p.ok) push(p.label, 'MISSING', C.bad);
    }
  }
  return (
    <Pane title="Health" color={C.ok} rows={rows.length + 5}>
      <Box flexDirection="column">
        {!status ? (
          <Text dim>probing...</Text>
        ) : (
          rows.map((r, i) => (
            <Text key={i} color={r.c} bold={r.c === C.bad}>
              {r.text}
            </Text>
          ))
        )}
      </Box>
    </Pane>
  );
}

function ConsolePane({ rows, cell }) {
  const entries = useConsole();
  const slots = Math.max(0, rows - 3);
  const startIdx = Math.max(0, entries.length - slots);
  const visible = entries.slice(startIdx);
  const lines = [];
  for (let i = 0; i < slots; i++) {
    const e = visible[i];
    lines.push(e ? `${KIND_MARK[e.kind]}${e.text}`.padEnd(cell).slice(0, cell) : ' '.padEnd(cell));
  }
  return (
    <Pane title={`console | ${entries.length} lines`} color={C.accent} rows={rows}>
      {lines.length === 0 ? (
        <Text dim>{'nothing yet - run an action or open the live log tab'.padEnd(cell).slice(0, cell)}</Text>
      ) : (
        lines.map((l, i) => {
          const e = visible[i];
          return (
            <Text key={startIdx + i} color={e ? KIND_COLORS[e.kind] : undefined}>
              {l}
            </Text>
          );
        })
      )}
    </Pane>
  );
}

function ModulePicker({ picker, index, width }) {
  const win = 18;
  const start = Math.max(0, Math.min(picker.items.length - win, index - Math.floor(win / 2)));
  const slice = picker.items.slice(start, start + win);
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={C.accent} height={win + 6} paddingX={1}>
      <Text bold color={C.accent}>
        {picker.title.padEnd(width).slice(0, width)}
      </Text>
      <Text dim>
        {`${picker.chosen.size}/${picker.items.length} selected | space | a all | n none | enter run | esc cancel`.slice(0, width)}
      </Text>
      {slice.map((it, i) => {
        const real = start + i;
        const on = picker.chosen.has(it);
        const active = real === index;
        const state = picker.state && picker.state[it] ? picker.state[it] : 'new';
        const mark = on ? '[x]' : '[ ]';
        const line = `${active ? '> ' : '  '}${mark} ${it}  ${state}`.padEnd(width).slice(0, width);
        return (
          <Text key={it} bold={active} color={active ? C.accent : on ? 'white' : C.dim}>
            {line}
          </Text>
        );
      })}
    </Box>
  );
}

function CloneWizard({ wizard, source, width }) {
  return (
    <Pane title="Snapshot & clone database" color={C.warn} rows={wizard.stage === 'name' ? 10 : 15}>
      <Text>{`source: ${source}`.slice(0, width)}</Text>
      {wizard.stage === 'name' ? (
        <>
          <Text dim>Enter a new name for a clone on this configured Odoo version.</Text>
          <Text dim>Cross-version upgrades require Odoo's supported upgrade process.</Text>
          <Text color={C.accent} bold>{`destination: ${wizard.destination || '_'}`.slice(0, width)}</Text>
          <Text dim>lowercase letters, numbers, underscore; start with a letter; max 63 chars</Text>
        </>
      ) : (
        <>
          <Text>{`destination: ${wizard.destination}`.slice(0, width)}</Text>
          <Text>Includes a PostgreSQL snapshot and the Odoo filestore.</Text>
          <Text>Source and its licensing data remain unchanged.</Text>
          <Text color={C.warn} bold>This does not reset subscription or expiry status.</Text>
          <Text>Existing destination database or filestore will not be overwritten.</Text>
          <Text dim>Snapshot is retained under Odoo data_dir/odoo-deck-backups.</Text>
          <Text dim>Afterward, check db_name/dbfilter in odoo.conf if needed.</Text>
        </>
      )}
    </Pane>
  );
}

function ErrorScreen({ error, top, height, width }) {
  const lines = error.text.split('\n');
  const rows = Math.max(10, height - 9);
  const slice = lines.slice(top, top + rows);
  const cell = Math.max(20, width - 4);
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text bold color={C.bad}>
        {error.label.padEnd(cell).slice(0, cell)}
      </Text>
      <Text color={C.warn}>
        {`${error.code} | ${lines.length} lines | up/down scroll`.padEnd(cell).slice(0, cell)}
      </Text>
      <Box borderStyle="single" borderColor={C.bad} flexDirection="column" height={rows + 1} marginTop={1}>
        {slice.map((l, i) => {
          const cellText = l.padEnd(cell).slice(0, cell);
          return (
            <Text key={top + i} color={/Traceback|Error:|CRITICAL|UserError|raise |File "/.test(l) ? C.warn : 'white'}>
              {cellText}
            </Text>
          );
        })}
      </Box>
    </Box>
  );
}

function Footer({ busy, picker, cloneWizard, screen, hasError, configOk }) {
  let hint;
  if (busy) hint = 'running - wait for it to finish';
  else if (picker)
    hint = 'up/down move | space toggle | a all | n none | enter run | esc cancel';
  else if (cloneWizard)
    hint = cloneWizard.stage === 'name' ? 'type destination | enter continue | esc cancel' : 'y/enter clone | n/esc cancel';
  else if (screen === 'error') hint = 'c copy traceback to clipboard | h/1 back';
  else if (screen === 'settings') hint = 'up/down field | enter edit | esc done | s save | 1 home';
  else if (screen === 'logs') hint = 'space pause/resume | c clear console | 1 home | 3 settings';
  else hint = `up/down choose | enter run | 1 home | 2 logs | 3 settings${hasError ? ' | e view error' : ''} | q quit`;
  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1} marginTop={1}>
      <Text dim>{hint}</Text>
    </Box>
  );
}

export default function App({ onExit }) {
  const { stdout } = useStdout();
  const width = stdout.columns || 100;
  const height = stdout.rows || 30;
  const lastError = useError();

  const [cfg, setCfg] = useState(null);
  const [status, setStatus] = useState(null);
  const [screen, setScreen] = useState('home');
  const [busy, setBusy] = useState(null);
  const [actionIndex, setActionIndex] = useState(0);
  const [picker, setPicker] = useState(null);
  const [cloneWizard, setCloneWizard] = useState(null);
  const [pickerIndex, setPickerIndex] = useState(0);
  const [settingsIndex, setSettingsIndex] = useState(0);
  const [editingKey, setEditingKey] = useState(null);
  const [editingValue, setEditingValue] = useState('');
  const [tailPaused, setTailPaused] = useState(false);
  const [errTop, setErrTop] = useState(0);

  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  const pausedRef = useRef(tailPaused);
  pausedRef.current = tailPaused;

  async function refresh() {
    if (!cfgRef.current) return;
    setStatus(await probe(cfgRef.current));
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      const c = await loadConfig();
      if (!alive) return;
      setCfg(c);
      const s = await probe(c);
      if (alive) {
        setStatus(s);
        consoleEmit('sys', `config loaded from ${CONFIG_PATH}`);
        consoleEmit('sys', `service: ${s.service} | db: ${s.dbOk ? 'reachable' : 'unreachable'} | admin: ${s.admin}`);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (screen !== 'logs' || !cfg) return;
    const tail = startLogTail(
      cfg,
      (lines) => {
        if (pausedRef.current) return;
        for (const l of lines) consoleEmit('log', l);
      },
      600,
    );
    return () => tail.stop();
  }, [screen]);

  async function run(label, fn) {
    if (busy) return;
    setBusy(label);
    clearLastError();
    setErrTop(0);
    try {
      await fn();
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      if (!errorGetSnapshot().last) {
        setLastError({ label: `${label} failed`, code: msg, text: msg });
      }
      consoleEmit('err', msg);
      setScreen('error');
    } finally {
      setBusy(null);
      await refresh();
    }
  }

  function confirmPicker() {
    const chosen = picker.items.filter((it) => picker.chosen.has(it));
    if (!chosen.length) {
      consoleEmit('warn', 'nothing selected.');
      setPicker(null);
      return;
    }
    const kind = picker.kind;
    const title = picker.title;
    setPicker(null);
    run(title, async () => {
      if (kind === 'upgrade' || kind === 'copyUpgrade') {
        await applyModules(cfgRef.current, { kind: 'upgrade', modules: chosen, alsoCopy: kind === 'copyUpgrade' });
      } else if (kind === 'install') {
        await applyModules(cfgRef.current, { kind: 'install', modules: chosen, alsoCopy: false });
      }
    });
  }

  function openPicker(kind) {
    if (!status) return;
    const states = status.states ?? {};
    let items;
    if (kind === 'upgrade' || kind === 'copyUpgrade') {
      items = status.modules.filter((m) => INSTALLED_STATES.includes(states[m]));
    } else if (kind === 'install') {
      items = status.modules.filter((m) => !INSTALLED_STATES.includes(states[m]));
    } else {
      return;
    }
    if (!items.length) {
      consoleEmit('warn', kind === 'install' ? 'no installable modules in sources.' : 'no installed modules found in sources.');
      return;
    }
    setPicker({
      kind,
      title:
        kind === 'install'
          ? 'Install modules'
          : kind === 'copyUpgrade'
            ? 'Copy + upgrade modules'
            : 'Upgrade modules',
      items,
      chosen: new Set(),
      state: states,
    });
    setPickerIndex(0);
  }

  function beginClone() {
    setCloneWizard({ stage: 'name', destination: '' });
  }

  function confirmClone() {
    const destination = cloneWizard.destination.trim();
    try {
      validateCloneDatabaseName(destination, cfgRef.current.db.name);
    } catch (error) {
      consoleEmit('warn', error.message);
      return;
    }
    setCloneWizard(null);
    run(`clone database to ${destination}`, () => cloneDatabase(cfgRef.current, destination));
  }

  const hasError = !!lastError;
  const menu = [];
  const add = (id, label, fn, need = {}) => {
    const disabled = (need.admin && status && !status.admin) || (need.db && !(status && status.dbOk)) || !status;
    menu.push({ id, label, disabled, tag: need.admin && status && !status.admin ? 'admin needed' : need.db && status && !status.dbOk ? 'db down' : undefined, fn });
  };
  add('sync', 'Sync module sources -> Odoo addons', () => run('sync module sources', () => syncAll(cfgRef.current)), { admin: true });
  add('install', 'Install modules', () => openPicker('install'), { admin: true, db: true });
  add('upgrade', 'Upgrade modules', () => openPicker('upgrade'), { admin: true, db: true });
  add('copyUpgrade', 'Copy + upgrade modules', () => openPicker('copyUpgrade'), { admin: true, db: true });
  add('clone', 'Snapshot & clone database (same version)', beginClone, { admin: true, db: true });
  add('reset', 'Reset stuck module states', () => run('reset module states', () => resetStuckModuleStates(cfgRef.current)), { db: true });
  add('restart', 'Restart Odoo service', () => run('restart service', () => restartService(cfgRef.current)), { admin: true });
  add('logs', 'Open live log tail', () => setScreen('logs'));
  if (hasError) add('error', 'View last error', () => setScreen('error'));
  add('settings', 'Open settings', () => setScreen('settings'));
  add('quit', 'Quit odoo-deck', () => onExit());

  function runById(id) {
    const it = menu.find((m) => m.id === id);
    if (it && !it.disabled && !busy) it.fn();
  }

  function runActionAt(i) {
    const it = menu[i];
    if (it && !it.disabled && !busy) it.fn();
  }

  async function doCopy() {
    if (!lastError) return;
    const ok = await copyToClipboard(lastError.text);
    if (ok) consoleEmit('ok', `copied ${lastError.text.length} chars to clipboard.`);
    else consoleEmit('err', 'clipboard copy failed.');
  }

  useInput((input, key) => {
    if (busy) return;
    if (picker) {
      if (key.upArrow) setPickerIndex((i) => Math.max(0, i - 1));
      else if (key.downArrow) setPickerIndex((i) => Math.min(picker.items.length - 1, i + 1));
      else if (input === ' ') {
        setPicker((p) => {
          const chosen = new Set(p.chosen);
          const name = p.items[pickerIndex];
          if (chosen.has(name)) chosen.delete(name);
          else chosen.add(name);
          return { ...p, chosen };
        });
      } else if (input === 'a') setPicker((p) => ({ ...p, chosen: new Set(p.items) }));
      else if (input === 'n') setPicker((p) => ({ ...p, chosen: new Set() }));
      else if (key.return) confirmPicker();
      else if (key.escape) setPicker(null);
      return;
    }

    if (cloneWizard) {
      if (cloneWizard.stage === 'name') {
        if (key.escape) setCloneWizard(null);
        else if (key.return) {
          if (!cloneWizard.destination) consoleEmit('warn', 'enter a destination database name.');
          else setCloneWizard((w) => ({ ...w, stage: 'confirm' }));
        } else if (key.backspace || key.delete || input === '\u0008' || input === '\u007f') {
          setCloneWizard((w) => ({ ...w, destination: w.destination.slice(0, -1) }));
        } else if (input) {
          const next = `${cloneWizard.destination}${input.toLowerCase()}`;
          if (/^[a-z][a-z0-9_]{0,62}$/.test(next)) setCloneWizard((w) => ({ ...w, destination: next }));
        }
      } else if (key.escape || input === 'n' || input === 'N') {
        setCloneWizard(null);
      } else if (key.return || input === 'y' || input === 'Y') {
        confirmClone();
      }
      return;
    }

    if (!editingKey) {
      const target =
        input === '1' ? 'home' : input === '2' ? 'logs' : input === '3' ? 'settings' : input === 'e' && hasError ? 'error' : null;
      if (target && target !== screen) {
        setScreen(target);
        return;
      }
    }

    if (screen === 'settings') {
      if (editingKey) {
        if (key.escape) setEditingKey(null);
        else if (key.return) {
          const def = FIELD_DEFS.find((f) => f.key === editingKey) ?? {};
          let value = editingValue;
          if (def.number) {
            const n = Number(editingValue);
            if (!Number.isFinite(n)) {
              consoleEmit('err', `${def.label} must be a number - change not saved.`);
              setEditingKey(null);
              return;
            }
            value = n;
          }
          setPath(cfg, editingKey, value);
          consoleEmit('sys', `updated ${def.label}`);
          setEditingKey(null);
        } else if (key.backspace || key.delete || input === '\u0008' || input === '\u007f') {
          setEditingValue((v) => v.slice(0, -1));
        } else if (input) setEditingValue((v) => v + input);
        return;
      }
      if (key.upArrow) setSettingsIndex((i) => Math.max(0, i - 1));
      else if (key.downArrow) setSettingsIndex((i) => Math.min(FIELD_DEFS.length, i + 1));
      else if (key.return) {
        if (settingsIndex === FIELD_DEFS.length) {
          run('save config', async () => {
            await saveConfig(cfg);
            consoleEmit('ok', `saved ${CONFIG_PATH}`);
          });
        } else {
          const def = FIELD_DEFS[settingsIndex];
          setEditingKey(def.key);
          setEditingValue(String(getPath(cfg, def.key) ?? ''));
        }
      } else if (input === 's') {
        run('save config', async () => {
          await saveConfig(cfg);
          consoleEmit('ok', `saved ${CONFIG_PATH}`);
        });
      } else if (input === '1' || key.escape) setScreen('home');
      return;
    }

    if (screen === 'logs') {
      if (input === ' ') setTailPaused((p) => !p);
      else if (input === 'c') clearConsole();
      else if (input === '1' || key.escape) setScreen('home');
      return;
    }

    if (screen === 'error') {
      if (input === 'c') doCopy();
      else if (input === '1' || input === 'h' || key.escape) setScreen('home');
      else if (key.upArrow) setErrTop((t) => Math.max(0, t - 1));
      else if (key.downArrow) setErrTop((t) => t + 1);
      else if (key.pageDown) setErrTop((t) => t + 20);
      else if (key.pageUp) setErrTop((t) => Math.max(0, t - 20));
      return;
    }

    if (screen === 'home') {
      if (key.upArrow) setActionIndex((i) => Math.max(0, i - 1));
      else if (key.downArrow) setActionIndex((i) => Math.min(menu.length - 1, i + 1));
      else if (key.return) runActionAt(actionIndex);
      else if (input === 'q') onExit();
    }
  });

  const leftW = Math.max(46, Math.floor(width * 0.5));
  const consoleRows = Math.max(10, Math.floor(height * 0.36));
  const consoleCell = Math.max(24, width - leftW - 12);

  if (!cfg) {
    return (
      <Box>
        <Text color={C.accent}>
          {FRAMES[0]} loading config...
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Header cfg={cfg} status={status} busy={busy} label={screen === 'error' ? 'error report ready' : screen === 'logs' ? 'tailing odoo.log' : 'ready'} />

      <Box paddingX={1} marginTop={1}>
        <Tabs active={screen} hasError={hasError} />
      </Box>

      <Box flexDirection="column" flexGrow={1} paddingX={1} marginTop={1}>
        {screen === 'home' && (
          <Box flexDirection="row">
            <Box flexDirection="column" width={leftW} marginRight={1}>
              {picker ? (
                <ModulePicker picker={picker} index={pickerIndex} width={leftW - 6} />
              ) : cloneWizard ? (
                <CloneWizard wizard={cloneWizard} source={cfg.db.name} width={leftW - 6} />
              ) : (
                <>
                  <Pane title="Actions" color={C.accent} rows={menu.length + 5}>
                    <Menu items={menu} index={actionIndex} width={leftW - 6} />
                    {!status && <Text dim>probing...</Text>}
                  </Pane>
                  <Box marginTop={1}>
                    <Health status={status} width={leftW - 6} />
                  </Box>
                </>
              )}
            </Box>
            <Box flexGrow={1}>
              <ConsolePane rows={consoleRows} cell={consoleCell} />
            </Box>
          </Box>
        )}

        {screen === 'logs' && (
          <Box flexDirection="row">
            <Box flexDirection="column" width={leftW} marginRight={1}>
              <Pane title="Live log" color={C.accent} rows={FIELD_DEFS.length + 6}>
                <Text>{`streaming from:`.padEnd(leftW - 6).slice(0, leftW - 6)}</Text>
                <Text>{cfg.logFile.padEnd(leftW - 6).slice(0, leftW - 6)}</Text>
                <Box marginTop={1} flexDirection="column">
                  <Text>
                    <Text color={tailPaused ? C.warn : C.ok} bold>
                      {tailPaused ? 'PAUSED' : 'STREAMING'}
                    </Text>
                  </Text>
                </Box>
              </Pane>
            </Box>
            <Box flexGrow={1}>
              <ConsolePane rows={consoleRows} cell={consoleCell} />
            </Box>
          </Box>
        )}

        {screen === 'settings' && (
          <Box flexDirection="column" flexGrow={1}>
            <Pane title="Settings" color={C.accent} rows={FIELD_DEFS.length + 6 + (editingKey ? 2 : 0)}>
              <Text dim>{`${CONFIG_PATH}   (s save | enter edit | esc done | 1/2/3 tabs)`.slice(0, width - 4)}</Text>
              {FIELD_DEFS.map((def, i) => {
                const active = i === settingsIndex;
                const isEditing = editingKey === def.key;
                const shown = isEditing ? editingValue : def.secret ? '********' : String(getPath(cfg, def.key) ?? '');
                return (
                  <Box key={def.key}>
                    <Box width={26}>
                      <Text color={active ? C.accent : C.dim} bold={active}>
                        {active ? '> ' : '  '}
                        {def.label.slice(0, 24)}
                      </Text>
                    </Box>
                    <Box flexGrow={1}>
                      <Text color={isEditing ? C.ok : active ? 'white' : 'gray'} bold={isEditing} wrap="truncate">
                        {shown}
                      </Text>
                    </Box>
                  </Box>
                );
              })}
              <Box>
                <Box width={26}>
                  <Text color={settingsIndex === FIELD_DEFS.length ? C.accent : C.dim} bold={settingsIndex === FIELD_DEFS.length}>
                    {settingsIndex === FIELD_DEFS.length ? '> ' : '  '}
                    {'Save settings'.slice(0, 24)}
                  </Text>
                </Box>
                <Box flexGrow={1}>
                  <Text color="gray">writes config.json and re-probes</Text>
                </Box>
              </Box>
              {editingKey && (
                <Box borderStyle="single" borderColor={C.ok} paddingX={1}>
                  <Text color={C.ok} bold>
                    {`EDIT ${(FIELD_DEFS.find((f) => f.key === editingKey) ?? {}).label}: `}
                  </Text>
                  <Text color="white" bold>
                    {editingValue.length ? editingValue : ' '}
                  </Text>
                </Box>
              )}
            </Pane>
          </Box>
        )}

        {screen === 'error' && hasError && <ErrorScreen error={lastError} top={errTop} height={height} width={width} />}
        {screen === 'error' && !hasError && <Text dim>no error recorded.</Text>}
      </Box>

      <Footer busy={busy} picker={picker} cloneWizard={cloneWizard} screen={screen} hasError={hasError} configOk={String(menu.length)} />
    </Box>
  );
}
