import { closeDatabase, migrateDatabase, seedDatabase } from './index.js';

const command = process.argv[2];
if (command === 'migrate') {
  migrateDatabase();
  console.log('Migrations appliquées.');
} else if (command === 'seed') {
  migrateDatabase();
  seedDatabase();
  console.log('Données initiales vérifiées.');
} else {
  console.error('Usage: db/cli.ts <migrate|seed>');
  process.exitCode = 1;
}
closeDatabase();
