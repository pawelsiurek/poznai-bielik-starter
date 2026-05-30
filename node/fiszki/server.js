import dotenv from 'dotenv';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });

import express from 'express';
import multer from 'multer';
import { unlinkSync } from 'fs';
import { randomUUID } from 'crypto';

import { load, save }                    from './modules/storage.js';
import { createClient, generateFiszki } from './modules/bielik.js';
import { getExtractor, supportedExtensions } from './modules/extractors/index.js';

// ─── Walidacja konfiguracji ────────────────────────────────────────────────

const apiKey = process.env.PCSS_API_KEY;
if (!apiKey || apiKey === 'twój_klucz_tutaj' || apiKey === '') {
  console.error('\nBłąd: brak PCSS_API_KEY w pliku .env\n');
  process.exit(1);
}

const bielik = createClient({
  apiKey,
  baseURL: process.env.PCSS_BASE_URL || 'https://llm.hpc.psnc.pl/v1',
});
const MODEL = process.env.PCSS_MODEL || 'bielik_11b';

// ─── Express ───────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use(express.static(resolve(__dirname, 'public')));

const upload = multer({
  dest: resolve(__dirname, 'uploads'),
  fileFilter: (_req, file, cb) => {
    const ok = getExtractor(file.originalname) !== null;
    cb(ok ? null : new Error(`Nieobsługiwany format. Dozwolone: ${supportedExtensions().join(', ')}`), ok);
  },
});

// ─── Upload + generowanie fiszek ───────────────────────────────────────────

app.post('/api/upload', upload.single('plik'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Brak pliku lub nieobsługiwany format' });

  const extract = getExtractor(req.file.originalname);
  let text;

  try {
    text = await extract(req.file.path);
  } catch (err) {
    // Ekstraktor rzucił błąd (np. stub dla obrazów/PDF)
    try { unlinkSync(req.file.path); } catch { /* ignore */ }
    return res.status(501).json({ error: err.message });
  } finally {
    try { unlinkSync(req.file.path); } catch { /* ignore */ }
  }

  console.log(`\nPrzetwarzam: ${req.file.originalname} (${text.length} znaków)`);

  try {
    const karty = await generateFiszki(bielik, MODEL, text);
    if (karty.length === 0)
      return res.status(422).json({ error: 'Bielik nie wygenerował żadnych fiszek. Sprawdź treść notatek.' });

    const fiszki = load();
    const nowe = karty.map(k => ({
      id: randomUUID(),
      przod: k.przod.trim(),
      tyl: k.tyl.trim(),
      zrodlo: req.file.originalname,
      created: new Date().toISOString(),
    }));

    fiszki.push(...nowe);
    save(fiszki);

    console.log(`Wygenerowano ${nowe.length} fiszek.\n`);
    res.json({ fiszki: nowe, count: nowe.length });
  } catch (err) {
    console.error('Błąd generowania:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── CRUD fiszek ───────────────────────────────────────────────────────────

app.get('/api/fiszki', (_req, res) => res.json(load()));

app.post('/api/fiszki', (req, res) => {
  const { przod, tyl } = req.body;
  if (!przod?.trim() || !tyl?.trim())
    return res.status(400).json({ error: 'Wymagane pola: przod i tyl' });

  const fiszki = load();
  const nowa = {
    id: randomUUID(),
    przod: przod.trim(),
    tyl: tyl.trim(),
    zrodlo: 'ręczna',
    created: new Date().toISOString(),
  };
  fiszki.push(nowa);
  save(fiszki);
  res.status(201).json(nowa);
});

app.put('/api/fiszki/:id', (req, res) => {
  const { przod, tyl } = req.body;
  const fiszki = load();
  const i = fiszki.findIndex(f => f.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: 'Fiszka nie znaleziona' });

  if (przod?.trim()) fiszki[i].przod = przod.trim();
  if (tyl?.trim()) fiszki[i].tyl = tyl.trim();
  fiszki[i].updated = new Date().toISOString();
  save(fiszki);
  res.json(fiszki[i]);
});

app.delete('/api/fiszki/:id', (req, res) => {
  const fiszki = load();
  const filtered = fiszki.filter(f => f.id !== req.params.id);
  if (filtered.length === fiszki.length) return res.status(404).json({ error: 'Fiszka nie znaleziona' });
  save(filtered);
  res.json({ ok: true });
});

app.delete('/api/fiszki', (req, res) => {
  const { zrodlo } = req.body;
  const fiszki = load();
  const filtered = zrodlo ? fiszki.filter(f => f.zrodlo !== zrodlo) : [];
  save(filtered);
  res.json({ ok: true, deleted: fiszki.length - filtered.length });
});

// ─── Start ─────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🧠 Inteligentne Fiszki → http://localhost:${PORT}\n`);
});
