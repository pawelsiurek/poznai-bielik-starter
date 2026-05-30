// Szacowanie tokenów dla Bielika (SentencePiece, podobny do Mistral)
// Brak oficjalnego JS tokenizera Bielika — używamy konserwatywnego przybliżenia
// Polski tekst: ok. 3–4 znaki/token, przyjmujemy 3.5 (bezpiecznie)

const CHARS_PER_TOKEN  = 3.5;
const CONTEXT_WINDOW   = 32_000;  // Bielik 11B
const RESERVED_TOKENS  = 6_000;   // system prompts (x2 etapy) + output (~4K)

export const MAX_INPUT_TOKENS = CONTEXT_WINDOW - RESERVED_TOKENS; // 26 000

export const estimateTokens = text => Math.ceil(text.length / CHARS_PER_TOKEN);

/**
 * Dzieli tekst Markdown na chunki nieprzekraczające maxTokens.
 * Split po nagłówkach (#, ##, ###) — zachowuje semantyczne sekcje.
 * Fallback: split po akapitach jeśli jeden nagłówek > limit.
 */
export function chunkByHeadings(text, maxTokens = MAX_INPUT_TOKENS) {
  if (estimateTokens(text) <= maxTokens) return [text];

  const maxChars = Math.floor(maxTokens * CHARS_PER_TOKEN);

  // Podziel zachowując nagłówek jako pierwszy znak sekcji
  const sections = text.split(/(?=\n#{1,3} )/);
  const chunks = [];
  let buf = '';

  for (const section of sections) {
    if ((buf + section).length > maxChars && buf) {
      chunks.push(buf.trim());
      buf = section;
    } else {
      buf += section;
    }
  }
  if (buf.trim()) chunks.push(buf.trim());

  // Fallback: jeśli pojedyncza sekcja nadal za duża — split po akapitach
  return chunks.flatMap(chunk => {
    if (chunk.length <= maxChars) return [chunk];
    const paragraphs = chunk.split(/\n\n+/);
    const sub = [];
    let pbuf = '';
    for (const p of paragraphs) {
      if ((pbuf + '\n\n' + p).length > maxChars && pbuf) {
        sub.push(pbuf.trim());
        pbuf = p;
      } else {
        pbuf = pbuf ? pbuf + '\n\n' + p : p;
      }
    }
    if (pbuf.trim()) sub.push(pbuf.trim());
    return sub;
  });
}

export function tokenSummary(text) {
  const tokens = estimateTokens(text);
  const pct    = Math.round((tokens / MAX_INPUT_TOKENS) * 100);
  return { tokens, maxTokens: MAX_INPUT_TOKENS, pct };
}
