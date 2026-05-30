import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = resolve(__dirname, '../prompts.json');

export const DEFAULT_PROMPTS = {
  etap1: `Jesteś systemem tworzącym fiszki edukacyjne na podstawie notatek. Twoim zadaniem jest wygenerowanie precyzyjnych pytań sprawdzających wiedzę.
Twórz konkretne pytania lub polecenia, które testują znajomość specyficznych faktów, definicji, mechanizmów i dat z tekstu.

Cechy dobrego pytania:
1. Jest jednoznaczne i w pełni zrozumiałe bez szerszego kontekstu.
2. Wymaga konkretnej odpowiedzi (np. "Podaj datę...", "Kim był...", "Na czym polega...").
3. Skupia się na najważniejszych informacjach, ignorując ogólniki.

Wymagania: Zadbaj o bezbłędną polszczyznę i poprawną składnię.
Odpowiedz TYLKO w JSON (bez markdown): {"pytania": ["Pytanie 1?", "Pytanie 2?"]}
Maksymalnie 15 pytań. Żadnych dodatkowych komentarzy poza JSON.`,

  etap2: `Jesteś systemem edukacyjnym. Otrzymasz listę pytań wygenerowanych z tekstu oraz oryginalne notatki.
Twoim zadaniem jest opracowanie tyłu fiszek na podstawie tego materiału.

Przód fiszki = dokładne skopiowanie pytania z dostarczonej listy.
Tył fiszki = zwięzła i precyzyjna odpowiedź (max 2 zdania) oparta na notatkach. NIE używaj cudzysłowów wewnątrz tekstu odpowiedzi.

Odpowiedz TYLKO w JSON (bez markdown): {"fiszki": [{"przod": "...", "tyl": "..."}]}
Żadnych dodatkowych komentarzy poza JSON.`,
};

export function loadPrompts() {
  if (!existsSync(CONFIG_FILE)) return { ...DEFAULT_PROMPTS };
  try {
    const saved = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
    return { ...DEFAULT_PROMPTS, ...saved };
  } catch {
    return { ...DEFAULT_PROMPTS };
  }
}

export function savePrompts(prompts) {
  writeFileSync(CONFIG_FILE, JSON.stringify(prompts, null, 2), 'utf-8');
}
