import OpenAI from 'openai';
import { chunkByHeadings, estimateTokens, MAX_INPUT_TOKENS } from './tokenizer.js';

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

async function generateForChunk(client, model, text) {
  const tokens = estimateTokens(text);
  if (tokens > MAX_INPUT_TOKENS) {
    throw new Error(`Chunk za duży: ~${tokens} tokenów (limit: ${MAX_INPUT_TOKENS})`);
  }

  console.log('  [1/2] Wyciągam pojęcia z tekstu...');
  const r1 = await client.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content: `Analizujesz notatki edukacyjne. Wyciągnij z nich kluczowe pojęcia, definicje i fakty warte zapamiętania.
Odpowiedz TYLKO w JSON (bez markdown): {"pojecia": ["pojecie1", "pojecie2"]}
Maksymalnie 15 pojęć. Żadnych dodatkowych komentarzy.`,
      },
      { role: 'user', content: `Notatki:\n\n${text}` },
    ],
    max_tokens: 500,
  });

  const pojecia = r1.choices[0].message.content;
  console.log('  [1/2] Gotowe →', pojecia.trim().substring(0, 120));

  console.log('  [2/2] Generuję fiszki...');
  const r2 = await client.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content: `Tworzysz fiszki edukacyjne. Na podstawie listy pojęć i oryginalnego tekstu stwórz pytania i odpowiedzi.
Przód fiszki = konkretne pytanie lub pojęcie do zdefiniowania.
Tył fiszki = zwięzła odpowiedź (max 2 zdania). NIE używaj cudzysłowów wewnątrz tekstu.
Odpowiedz TYLKO w JSON (bez markdown): {"fiszki": [{"przod": "...", "tyl": "..."}]}
Żadnych dodatkowych komentarzy poza JSON.`,
      },
      {
        role: 'user',
        content: `Pojęcia do opracowania: ${pojecia}\n\nOryginalne notatki (kontekst):\n${text.substring(0, 4000)}`,
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
export async function generateFiszki(client, model, text) {
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
    const fiszki = await generateForChunk(client, model, chunks[i]);
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
