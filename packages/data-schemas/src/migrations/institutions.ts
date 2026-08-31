import type { Connection } from 'mongoose';
import logger from '~/config/winston';

/** Idempotently provisions the initial development institution. */
export async function ensureInitialInstitution(connection: Connection): Promise<void> {
  const collection = connection.db!.collection('institutions');
  await collection.updateOne(
    { _id: 'SEEDS' },
    {
      $setOnInsert: {
        _id: 'SEEDS',
        name: 'SEEDS',
        status: 'enabled',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    },
    { upsert: true },
  );
  logger.info('[InstitutionMigration] Ensured initial institution SEEDS exists');
}
