import { z } from 'zod';

import { loadConfig } from './bootstrap/config.js';
import { backupDatabase } from './infrastructure/database/backup.js';
import { createDatabase } from './infrastructure/database/connection.js';

const config = loadConfig();
const destination = z.string().trim().min(1).parse(process.env.BACKUP_FILE);
const database = createDatabase(config.databaseFile);

try {
  await backupDatabase(database.sqlite, destination);
  process.stdout.write('Backup SQLite concluído.\n');
} finally {
  database.close();
}
