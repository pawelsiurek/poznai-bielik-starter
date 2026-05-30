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
        content: `Jesteś systemem tworzącym fiszki edukacyjne na podstawie notatek. Twoim zadaniem jest wygenerowanie precyzyjnych pytań sprawdzających wiedzę.
Twórz konkretne pytania lub polecenia, które testują znajomość specyficznych faktów, definicji, mechanizmów i dat z tekstu.

Cechy dobrego pytania:
1. Jest jednoznaczne i w pełni zrozumiałe bez szerszego kontekstu.
2. Wymaga konkretnej odpowiedzi (np. "Podaj datę...", "Kim był...", "Na czym polega...").
3. Skupia się na najważniejszych informacjach, ignorując ogólniki.

Wymagania: Zadbaj o bezbłędną polszczyznę i poprawną składnię.
Odpowiedz TYLKO w JSON (bez markdown): {"pytania": ["Pytanie 1?", "Pytanie 2?"]}
Maksymalnie 15 pytań. Żadnych dodatkowych komentarzy poza JSON.`,
      },
      { role: 'user', content: `Notatki:\n\n${text}` },
    ],
    max_tokens: 800, // Zwiększyłem lekko limit, bo pytania zajmują więcej tokenów niż pojedyncze słowa
  });

  const pytaniaJson = r1.choices[0].message.content;
  console.log('  [1/2] Gotowe →', pytaniaJson.trim().substring(0, 120));

  console.log('  [2/2] Generuję fiszki...');
  const r2 = await client.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content: `Jesteś systemem edukacyjnym. Otrzymasz listę pytań wygenerowanych z tekstu oraz oryginalne notatki.
Twoim zadaniem jest opracowanie tyłu fiszek na podstawie tego materiału.

Przód fiszki = dokładne skopiowanie pytania z dostarczonej listy.
Tył fiszki = zwięzła i precyzyjna odpowiedź (max 2 zdania) oparta na notatkach. NIE używaj cudzysłowów wewnątrz tekstu odpowiedzi.

Odpowiedz TYLKO w JSON (bez markdown): {"fiszki": [{"przod": "...", "tyl": "..."}]}
Żadnych dodatkowych komentarzy poza JSON.`,
      },
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
