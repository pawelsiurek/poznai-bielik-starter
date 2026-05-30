// TODO: zaimplementować z docling lub innym OCR
// Instalacja: pip install docling  →  python -m docling <plik>
// Alternatywnie: tesseract.js (npm install tesseract.js)

export const extensions = ['.png', '.jpg', '.jpeg', '.webp', '.bmp'];

export async function extract(_filePath) {
  throw new Error('Obsługa obrazów nie jest jeszcze dostępna. Wkrótce: docling / OCR.');
}
