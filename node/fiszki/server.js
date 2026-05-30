import dotenv from 'dotenv';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });

import express from 'express';
import multer from 'multer';
import { unlinkSync } from 'fs';
import { randomUUID } from 'crypto';
import http from 'http';               // ADDED: For WebSockets
import { Server } from 'socket.io';    // ADDED: Socket.io library
import os from 'os';                   // ADDED: To find your local Wi-Fi IP

import { load, save }                        from './modules/storage.js';
import { createClient, generateFiszki }      from './modules/bielik.js';
import { getExtractor, supportedExtensions } from './modules/extractors/index.js';
import { checkDocling }                      from './modules/extractors/pdf.js';

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

// ─── Sprawdzenie Docling (nieblokujące — serwer działa bez niego) ──────────

const doclingAvailable = checkDocling();
if (doclingAvailable) {
  console.log('✓ Docling dostępny — obsługa PDF włączona');
} else {
  console.warn('⚠ Docling niedostępny — obsługa PDF wyłączona');
  console.warn('  Aby włączyć: pip install docling  (wymagany Python)');
  console.warn('  Szczegóły: requirements.txt\n');
}

// ─── Express & WebSockets Setup ────────────────────────────────────────────

const app = express();
const server = http.createServer(app); // Wrapped express in HTTP server
const io = new Server(server);         // Initialized Socket.io

app.use(express.json());
app.use(express.static(resolve(__dirname, 'public')));

// ─── Real-time Communication (Socket.io) ───────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[Socket] Nowe połączenie: ${socket.id}`);

  // Listen for a student submitting a card
  socket.on('submit_flashcard', (data) => {
    const { nazwaUcznia, przod, tyl } = data;
    
    if (!przod?.trim() || !tyl?.trim()) return;

    const fiszki = load();
    const nowa = {
      id: randomUUID(),
      przod: przod.trim(),
      tyl: tyl.trim(),
      zrodlo: `Uczeń: ${nazwaUcznia || 'Anonim'}`, // Tags the card with the student's name
      created: new Date().toISOString(),
    };
    
    fiszki.push(nowa);
    save(fiszki);

    console.log(`[Socket] Fiszka od ucznia ${nazwaUcznia} została zapisana.`);

    // Instantly broadcast the new card to everyone (including the Host screen)
    io.emit('new_flashcard_received', nowa);
  });

  socket.on('disconnect', () => {
    console.log(`[Socket] Odłączono: ${socket.id}`);
  });
});

// ─── Upload + generowanie fiszek ───────────────────────────────────────────
// (This section remains exactly the same as your original)

const upload = multer({
  dest: resolve(__dirname, 'uploads'),
  fileFilter: (_req, file, cb) => {
    const ok = getExtractor(file.originalname) !== null;
    cb(ok ? null : new Error(`Nieobsługiwany format. Dozwolone: ${supportedExtensions().join(', ')}`), ok);
  },
});

// ─── Endpoint: info o możliwościach serwera ────────────────────────────────

app.get('/api/capabilities', (_req, res) => {
  res.json({
    docling: doclingAvailable,
    formats: supportedExtensions(),
    activeFormats: supportedExtensions().filter(ext =>
      ext === '.txt' || (ext === '.pdf' && doclingAvailable)
    ),
  });
});

// ─── Upload + generowanie fiszek ───────────────────────────────────────────


app.post('/api/upload', upload.single('plik'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Brak pliku lub nieobsługiwany format' });

  const extract = getExtractor(req.file.originalname);
  let text;

  try {
    text = await extract(req.file.path);
  } catch (err) {
    try { unlinkSync(req.file.path); } catch { /* ignore */ }
    const code = err.message.includes('nie jest zainstalowany') ? 501 : 422;
    return res.status(code).json({ error: err.message });
  } finally {
    try { unlinkSync(req.file.path); } catch { /* ignore */ }
  }

  const ext = req.file.originalname.split('.').pop().toLowerCase();
  console.log(`\nPrzetwarzam: ${req.file.originalname} (${text.length} znaków, format: ${ext})`);

  try {
    const { fiszki: karty, meta } = await generateFiszki(bielik, MODEL, text);

    if (karty.length === 0)
      return res.status(422).json({ error: 'Bielik nie wygenerował żadnych fiszek. Sprawdź treść pliku.' });

    const all = load();
    const nowe = karty.map(k => ({
      id:      randomUUID(),
      przod:   k.przod.trim(),
      tyl:     k.tyl.trim(),
      zrodlo:  req.file.originalname,
      created: new Date().toISOString(),
    }));

    all.push(...nowe);
    save(all);

    console.log(`Wygenerowano ${nowe.length} fiszek (${meta.chunks} chunk(ów), ~${meta.totalTokens} tokenów)\n`);
    nowe.forEach(karta => io.emit('new_flashcard_received', karta));
    res.json({ fiszki: nowe, count: nowe.length, meta });
  } catch (err) {
    console.error('Błąd generowania:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── CRUD fiszek ───────────────────────────────────────────────────────────
// (This section remains exactly the same as your original)

app.get('/api/fiszki', (_req, res) => res.json(load()));

app.post('/api/fiszki', (req, res) => {
  const { przod, tyl } = req.body;
  if (!przod?.trim() || !tyl?.trim())
    return res.status(400).json({ error: 'Wymagane pola: przod i tyl' });

  const fiszki = load();
  const nowa = {
    id:      randomUUID(),
    przod:   przod.trim(),
    tyl:     tyl.trim(),
    zrodlo:  'ręczna',
    created: new Date().toISOString(),
  };
  fiszki.push(nowa);
  save(fiszki);
  
  // Optional: Update host screen on manual API post too
  io.emit('new_flashcard_received', nowa);
  
  res.status(201).json(nowa);
});

app.put('/api/fiszki/:id', (req, res) => {
  const { przod, tyl } = req.body;
  const fiszki = load();
  const i = fiszki.findIndex(f => f.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: 'Fiszka nie znaleziona' });

  if (przod?.trim()) fiszki[i].przod = przod.trim();
  if (tyl?.trim())   fiszki[i].tyl   = tyl.trim();
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

// ─── Network Helper ────────────────────────────────────────────────────────
// Finds your computer's local Wi-Fi IP address

function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// ─── Start ─────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

server.listen(PORT, HOST, () => {
  const localIp = getLocalIpAddress();
  console.log(`\n🧠 Inteligentne Fiszki (Ekran Główny) → http://localhost:${PORT}`);
  console.log(`📱 Link do kodu QR (dla uczniów)     → http://${localIp}:${PORT}/student.html\n`);
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nBłąd: port ${PORT} jest już zajęty.`);
    console.error(`Zabij proces i spróbuj ponownie:\n`);
    console.error(`  lsof -ti :${PORT} | xargs kill -9\n`);
  } else {
    console.error(`\nBłąd serwera: ${err.message}\n`);
  }
  process.exit(1);
});
