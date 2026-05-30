import { execSync }                              from 'child_process';
import { readFileSync, existsSync, copyFileSync,
         mkdtempSync, readdirSync, rmSync }       from 'fs';
import { join }                                   from 'path';
import { tmpdir }                                 from 'os';
import { randomUUID }                             from 'crypto';

// Rekurencyjne szukanie plików .md — docling może tworzyć podkatalogi
function findMdFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) results.push(...findMdFiles(full));
    else if (entry.name.endsWith('.md')) results.push(full);
  }
  return results;
}

export const extensions = ['.pdf'];

// Rozszerzona PATH — docling często ląduje w ~/.local/bin (pip install --user)
function buildEnv() {
  const extra = [
    `${process.env.HOME}/.local/bin`,
    '/usr/local/bin',
    '/opt/homebrew/bin',
    `${process.env.HOME}/.venv/bin`,
  ];
  return {
    ...process.env,
    PATH: [...extra, process.env.PATH].filter(Boolean).join(':'),
    // Apple Silicon: MPS nie obsługuje float64 — fallback na CPU dla takich operacji
    PYTORCH_ENABLE_MPS_FALLBACK: '1',
  };
}

// Sprawdzenie raz przy imporcie modułu
let _doclingCmd  = null;
let _doclingOk   = null;

export function checkDocling() {
  if (_doclingOk !== null) return _doclingOk;
  const env = buildEnv();
  try {
    execSync('docling --version', { env, stdio: 'pipe', timeout: 8_000 });
    _doclingCmd = 'docling';
    _doclingOk  = true;
  } catch {
    _doclingOk = false;
  }
  return _doclingOk;
}

export async function extract(filePath) {
  if (!checkDocling()) {
    throw new Error(
      'Docling nie jest zainstalowany lub nie jest w PATH.\n' +
      'Zainstaluj: pip install docling\n' +
      'Sprawdź PATH: which docling\n' +
      'Szczegóły: requirements.txt w głównym folderze projektu.'
    );
  }

  const env    = buildEnv();
  const tmpPdf = join(tmpdir(), `fiszki-${randomUUID()}.pdf`);
  const outDir = mkdtempSync(join(tmpdir(), 'fiszki-docling-'));

  try {
    // Docling wykrywa format po rozszerzeniu — multer usuwa .pdf, musimy je przywrócić
    copyFileSync(filePath, tmpPdf);
    console.log('[PDF] Uruchamiam docling (konwersja PDF → Markdown)...');
    console.log('[PDF] tmpPdf:', tmpPdf);
    console.log('[PDF] outDir:', outDir);

    let doclingStdout = '';
    let doclingStderr = '';
    try {
      // --device cpu: wymuszone CPU (MPS nie obsługuje float64 w RT-DETRv2)
      const result = execSync(`docling "${tmpPdf}" --to md --output "${outDir}" --device cpu`, {
        env,
        encoding: 'utf-8',
        timeout:  180_000,
      });
      doclingStdout = result || '';
    } catch (execErr) {
      doclingStderr = execErr.stderr?.toString() || '';
      doclingStdout = execErr.stdout?.toString() || '';
      console.error('[PDF] Docling błąd (stderr):', doclingStderr.substring(0, 500));
      throw execErr;
    }

    if (doclingStdout) console.log('[PDF] Docling stdout:', doclingStdout.substring(0, 300));

    console.log('[PDF] Docling zakończył konwersję.');
    console.log('[PDF] Zawartość outDir:', readdirSync(outDir, { recursive: true }));

    const mdFiles = findMdFiles(outDir);
    if (mdFiles.length === 0) {
      throw new Error('Docling nie wygenerował pliku .md. Sprawdź czy PDF nie jest zaszyfrowany lub pusty.');
    }
    console.log('[PDF] Znaleziono plik:', mdFiles[0]);

    const text = readFileSync(mdFiles[0], 'utf-8').trim();
    if (text.length < 100) {
      throw new Error('Docling zwrócił za mało tekstu — PDF może być skanem bez OCR lub być pusty.');
    }
    console.log('[PDF] Markdown gotowy:', text.length, 'znaków');
    return text;
  } catch (err) {
    // Przepakuj błędy docling na czytelniejsze komunikaty
    if (err.status !== undefined && err.stderr) {
      const stderr = err.stderr.toString();
      if (stderr.includes('Unsupported') || stderr.includes('encrypted')) {
        throw new Error('PDF jest zaszyfrowany lub nieobsługiwany przez docling.');
      }
      throw new Error(`Docling błąd: ${stderr.substring(0, 300)}`);
    }
    throw err;
  } finally {
    try { rmSync(tmpPdf, { force: true }); }    catch { /* ignore */ }
    try { rmSync(outDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
