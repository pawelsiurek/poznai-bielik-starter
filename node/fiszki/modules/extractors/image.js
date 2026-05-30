import { readFileSync } from 'fs';
import { extname }      from 'path';
import OpenAI           from 'openai';

export const extensions = ['.png', '.jpg', '.jpeg', '.webp', '.bmp'];

let _client = null;
let _model  = null;

export function initQwenClient(client, model) {
  _client = client;
  _model  = model;
}

const MIME = {
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.webp': 'image/webp',
  '.bmp':  'image/bmp',
};

export async function extract(filePath) {
  if (!_client) {
    throw new Error('Qwen VL nie jest skonfigurowany. Sprawdź QWEN_MODEL w .env.');
  }

  const ext    = extname(filePath).toLowerCase();
  const mime   = MIME[ext] ?? 'image/jpeg';
  const base64 = readFileSync(filePath).toString('base64');

  console.log(`[IMG] Base64: ${(base64.length / 1024).toFixed(0)} KB → Qwen3-VL...`);

  const r = await _client.chat.completions.create({
    model: _model,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: { url: `data:${mime};base64,${base64}` },
        },
        {
          type: 'text',
          text: 'Wyciągnij CAŁY tekst z tego obrazu dokładnie tak jak jest napisany. Zachowaj strukturę: nagłówki, listy, akapity, tabele. Jeśli tekst jest odręczny — transkrybuj go jak najdokładniej. Zwróć TYLKO tekst, żadnych komentarzy ani objaśnień.',
        },
      ],
    }],
    max_tokens: 4000,
  });

  const text = r.choices[0].message.content.trim();
  console.log(`[IMG] OCR gotowe: ${text.length} znaków`);

  if (text.length < 10) {
    throw new Error('Qwen nie wykrył tekstu w obrazie — sprawdź jakość zdjęcia.');
  }
  return text;
}
