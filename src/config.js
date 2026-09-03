import { dirname, join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

const srcDir = import.meta.dir;
export const IS_COMPILED = String(process.argv[1] ?? '').includes('~BUN');
export const APP_DIR = IS_COMPILED ? dirname(process.execPath) : join(srcDir, '..');
export const CONFIG_PATH = join(APP_DIR, 'config.json');

export const INSTALL_DIR = 'C:\\Program Files\\Odoo 19.0e.20260702';

export const DEFAULT_SRC_DIRS = [
  'C:\\dev\\Woocommerce\\custom',
  'C:\\dev\\Woocommerce\\third_party\\oca',
  'C:\\dev\\Woocommerce\\third_party\\unicoding',
  'C:\\dev\\Woocommerce\\third_party\\emipro',
];

export function defaultConfig() {
  return {
    installDir: INSTALL_DIR,
    python: join(INSTALL_DIR, 'python', 'python.exe'),
    odooBin: join(INSTALL_DIR, 'server', 'odoo-bin'),
    odooConf: join(INSTALL_DIR, 'server', 'odoo.conf'),
    logFile: join(INSTALL_DIR, 'server', 'odoo.log'),
    psql: join(INSTALL_DIR, 'postgresql', 'bin', 'psql.exe'),
    srcDirs: DEFAULT_SRC_DIRS.join(','),
    destAddons: join(INSTALL_DIR, 'server', 'odoo', 'addons'),
    service: 'odoo-server-19.0',
    db: {
      host: 'localhost',
      port: 5432,
      user: 'fractal',
      password: 'fractal',
      name: 'fractal_odoo_19',
    },
  };
}

export const FIELD_DEFS = [
  { key: 'installDir', label: 'Odoo install dir' },
  { key: 'python', label: 'Python executable' },
  { key: 'odooBin', label: 'odoo-bin' },
  { key: 'odooConf', label: 'odoo.conf' },
  { key: 'logFile', label: 'Odoo log file' },
  { key: 'psql', label: 'psql.exe' },
  { key: 'srcDirs', label: 'Module source dirs (csv)' },
  { key: 'destAddons', label: 'Odoo addons dir' },
  { key: 'service', label: 'Windows service name' },
  { key: 'db.name', label: 'Database name', type: 'text' },
  { key: 'db.user', label: 'DB user' },
  { key: 'db.password', label: 'DB password', secret: true },
  { key: 'db.host', label: 'DB host' },
  { key: 'db.port', label: 'DB port', number: true },
];

export function getPath(obj, key) {
  return key.split('.').reduce((acc, part) => (acc == null ? acc : acc[part]), obj);
}

export function setPath(obj, key, value) {
  const parts = key.split('.');
  let cursor = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    cursor[parts[i]] = cursor[parts[i]] ?? {};
    cursor = cursor[parts[i]];
  }
  const last = parts[parts.length - 1];
  cursor[last] = typeof value === 'string' && value.trim() === '' ? '' : value;
}

export async function loadConfig() {
  const defaults = defaultConfig();
  try {
    const raw = await readFile(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const merged = {
      ...defaults,
      ...parsed,
      db: { ...defaults.db, ...(parsed.db ?? {}) },
    };
    return merged;
  } catch {
    await saveConfig(defaults);
    return defaults;
  }
}

export async function saveConfig(cfg) {
  await writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
}
