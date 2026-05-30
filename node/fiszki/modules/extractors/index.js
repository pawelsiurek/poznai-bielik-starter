import { extname } from 'path';
import * as txt   from './txt.js';
import * as image from './image.js';
import * as pdf   from './pdf.js';

const registry = {};
[txt, image, pdf].forEach(mod => {
  mod.extensions.forEach(ext => { registry[ext] = mod.extract; });
});

// Zwraca funkcję extract(filePath) dla danego pliku, lub null jeśli nieobsługiwany
export function getExtractor(filename) {
  const ext = extname(filename).toLowerCase();
  return registry[ext] ?? null;
}

export function supportedExtensions() {
  return Object.keys(registry);
}
