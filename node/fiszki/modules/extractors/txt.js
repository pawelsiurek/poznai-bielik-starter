import { readFileSync } from 'fs';

export const extensions = ['.txt'];

export async function extract(filePath) {
  return readFileSync(filePath, 'utf-8');
}
