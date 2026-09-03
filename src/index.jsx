#!/usr/bin/env bun
import React from 'react';
import { render } from 'ink';
import { join, resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import App from './App.jsx';
import { APP_DIR, CONFIG_PATH, IS_COMPILED, loadConfig } from './config.js';
import { probe, isAdmin } from './odoo.js';

const INSTALLED_STATES = ['installed', 'to upgrade', 'to install'];

function sq(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function printStatus() {
  const cfg = await loadConfig();
  const s = await probe(cfg);
  console.log('odoo-deck status');
  console.log(`  config : ${CONFIG_PATH}`);
  console.log(`  install: ${cfg.installDir}`);
  console.log(`  admin  : ${s.admin}`);
  console.log(`  service: ${s.service}`);
  console.log(`  db     : ${s.dbOk ? 'reachable' : 'UNREACHABLE'} (${cfg.db.name}@${cfg.db.host}:${cfg.db.port})`);
  console.log(`  repo modules: ${s.modules.length}`);
  for (const p of s.paths) {
    const where = p.key ? cfg[p.key] : p.extra ?? '';
    console.log(`  path   : ${p.label.padEnd(18)} ${p.ok ? 'ok     ' : 'MISSING'}  ${where}`);
  }
  const installed = s.modules.filter((m) => INSTALLED_STATES.includes(s.states[m]));
  const installable = s.modules.filter((m) => !INSTALLED_STATES.includes(s.states[m]) && s.states[m]);
  console.log(`  installed : ${installed.join(', ') || '(none from sources)'}`);
  console.log(`  installable: ${installable.join(', ') || '(none from sources)'}`);
  const badPaths = s.paths.filter((p) => !p.ok).length;
  if (!s.dbOk || badPaths > 0) process.exitCode = 1;
}

async function relaunchElevated() {
  const wrapper = join(APP_DIR, '.odoo-deck-elevate.cmd');
  let runLine;
  if (IS_COMPILED) {
    runLine = `"${process.execPath}" --elevated`;
  } else {
    const bun = process.execPath || 'bun.exe';
    const script = resolve(process.cwd(), process.argv[1] ?? join(APP_DIR, 'src', 'index.jsx'));
    runLine = `"${bun}" "${script}" --elevated`;
  }
  const wrapperText = [
    '@echo off',
    'setlocal',
    'color 07',
    'mode con cols=160 lines=50 >nul 2>&1',
    `cd /d "${APP_DIR}"`,
    runLine,
    'if errorlevel 1 (',
    '  echo.',
    '  echo odoo-deck exited with code %errorlevel%',
    '  pause',
    ')',
    'exit /b %errorlevel%',
  ].join('\r\n');
  await writeFile(wrapper, wrapperText, 'utf8');
  const cmd = `Start-Process -FilePath 'cmd.exe' -ArgumentList '/c',${sq(wrapper)} -Verb RunAs`;
  try {
    const p = Bun.spawnSync(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', cmd], {
      stdout: 'ignore',
      stderr: 'ignore',
    });
    return p.exitCode === 0;
  } catch {
    return false;
  }
}

const args = process.argv;
const isTty = () => process.stdout.isTTY && process.stdin.isTTY;

if (args.includes('--status')) {
  await printStatus();
} else if (!isTty()) {
  console.log('odoo-deck needs an interactive terminal.');
  console.log('Run:  bun start        (opens the TUI)');
  console.log('      bun status       (prints health, no UI)');
} else {
  if (!args.includes('--elevated') && !args.includes('--no-elevate')) {
    const admin = await isAdmin();
    if (!admin) {
      console.log('odoo-deck: administrator privileges not detected.');
      console.log('  requesting elevation (accept the UAC prompt)...');
      const ok = await relaunchElevated();
      if (ok) {
        console.log('  odoo-deck restarted as Administrator in a new window.');
        console.log('  you can close this window now.');
        process.exit(0);
      } else {
        console.log('  elevation declined or unavailable - running with limited rights.');
      }
    }
  }
  const { unmount } = render(<App onExit={() => process.exit(0)} />);
  process.on('SIGINT', () => {
    unmount();
    process.exit(0);
  });
}
