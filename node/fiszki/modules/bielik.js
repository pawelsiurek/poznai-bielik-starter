import OpenAI from 'openai';
import { chunkByHeadings, estimateTokens, MAX_INPUT_TOKENS } from './tokenizer.js';
import { DEFAULT_PROMPTS } from './config.js';

export function createClient({ apiKey, baseURL }) {
  return new OpenAI({ apiKey, baseURL });
}

function extractFiszki(raw) {
  const stripped = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  // Próba 1: pełny JSON
  try {
    const m = stripped.match(/\{[\s\S]*\}/);
    if (m) {
      const parsed = JSON.parse(m[0]);
      const list = parsed.fiszki ?? parsed;
      if (Array.isArray(list) && list.length) return list;
    }
  } catch { /* fall through */ }

  // Próba 2: wyciągnij poszczególne obiekty regexem (gdy JSON ucięty lub z nieescapowanymi cudzysłowami)
  const cards = [];
  const re = /\{\s*"przod"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"tyl"\s*:\s*"((?:[^"\\]|\\.)*)"\s*\}/gs;
  let m;
  while ((m = re.exec(raw)) !== null) {
    try {
      const przod = JSON.parse(`"${m[1]}"`);
      const tyl   = JSON.parse(`"${m[2]}"`);
      if (przod && tyl) cards.push({ przod, tyl });
    } catch { /* pomiń uszkodzoną kartę */ }
  }

  if (cards.length) return cards;
  throw new Error(`Bielik zwrócił nieprawidłowy JSON. Fragment: ${raw.substring(0, 200)}`);
}

async function generateForChunk(client, model, text, prompts) {
  const tokens = estimateTokens(text);
  if (tokens > MAX_INPUT_TOKENS) {
    throw new Error(`Chunk za duży: ~${tokens} tokenów (limit: ${MAX_INPUT_TOKENS})`);
  }

  console.log('  [1/2] Wyciągam pojęcia z tekstu...');
  const r1 = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: prompts.etap1 },
      { role: 'user',   content: `Notatki:\n\n${text}` },
    ],
    max_tokens: 800,
  });

  const pytaniaJson = r1.choices[0].message.content;
  console.log('  [1/2] Gotowe →', pytaniaJson.trim().substring(0, 120));

  console.log('  [2/2] Generuję fiszki...');
  const r2 = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: prompts.etap2 },
      {
        role: 'user',
        content: `Wygenerowane pytania: ${pytaniaJson}\n\nOryginalne notatki (kontekst):\n${text.substring(0, 4000)}`,
      },
    ],
    max_tokens: 4000,
  });

  const fiszki = extractFiszki(r2.choices[0].message.content)
    .filter(f => f.przod?.trim() && f.tyl?.trim());
  console.log('  [2/2] Gotowe →', fiszki.length, 'fiszek');
  return fiszki;
}

/**
 * Zwraca { fiszki: [], meta: { chunks, totalTokens, chunkTokens[] } }
 */
export async function generateFiszki(client, model, text, prompts = null) {
  prompts = { ...DEFAULT_PROMPTS, ...prompts };
  const totalTokens = estimateTokens(text);
  const chunks = chunkByHeadings(text);

  console.log('\n─────────────────────────────────');
  console.log(`[Bielik] Tekst: ~${totalTokens} tokenów → ${chunks.length} chunk(ów)`);

  const allFiszki = [];
  const chunkTokens = [];

  for (let i = 0; i < chunks.length; i++) {
    const t = estimateTokens(chunks[i]);
    chunkTokens.push(t);
    console.log(`[Etap 1+2] Chunk ${i + 1}/${chunks.length} (~${t} tokenów) (${Math.round(t/26000*100)}% okna kontekstowego)...`);
    const fiszki = await generateForChunk(client, model, chunks[i], prompts);
    console.log(`           → ${fiszki.length} fiszek`);
    allFiszki.push(...fiszki);
  }

  console.log('─────────────────────────────────');
  console.log('[Bielik] Łącznie:', allFiszki.length, 'fiszek z', chunks.length, 'chunk(ów)');
  return {
    fiszki: allFiszki,
    meta: { chunks: chunks.length, totalTokens, chunkTokens },
  };
}
