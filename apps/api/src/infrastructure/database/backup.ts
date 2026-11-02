import { closeSync, chmodSync, mkdirSync, openSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type Database from 'better-sqlite3';

export async function backupDatabase(
  sqlite: Database.Database,
  destination: string,
): Promise<void> {
  const destinationFile = resolve(destination);
  const sourceFile = sqlite.name === ':memory:' ? undefined : resolve(sqlite.name);

  if (sourceFile === destinationFile) {
    throw new Error('O destino do backup deve ser diferente do banco de origem.');
  }

  mkdirSync(dirname(destinationFile), { recursive: true, mode: 0o700 });

  const destinationDescriptor = openSync(destinationFile, 'wx', 0o600);
  closeSync(destinationDescriptor);

  try {
    await sqlite.backup(destinationFile);
    chmodSync(destinationFile, 0o600);
  } catch (error) {
    rmSync(destinationFile, { force: true });
    throw error;
  }
}
