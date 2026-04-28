import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { GeneratedFile } from './message.js';

export function writeFiles(files: GeneratedFile[], outputDir: string): void {
  mkdirSync(outputDir, { recursive: true });
  for (const file of files) {
    writeFileSync(join(outputDir, file.name), file.content, 'utf-8');
  }
}
