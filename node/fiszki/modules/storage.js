import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_FILE = resolve(__dirname, '../fiszki.json');

export function load() {
  if (!existsSync(DB_FILE)) return [];
  try { return JSON.parse(readFileSync(DB_FILE, 'utf-8')); } catch { return []; }
}

export function save(data) {
  writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
}
