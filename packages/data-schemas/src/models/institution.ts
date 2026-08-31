import { Model } from 'mongoose';
import type { IInstitution } from '~/types/institution';
import institutionSchema from '~/schema/institution';

/** Institution is a platform-global registry, not a tenant-isolated resource. */
export function createInstitutionModel(mongoose: typeof import('mongoose')): Model<IInstitution> {
  return mongoose.models.Institution || mongoose.model<IInstitution>('Institution', institutionSchema);
}
