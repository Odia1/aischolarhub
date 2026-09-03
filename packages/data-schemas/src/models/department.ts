import type { Model } from 'mongoose';
import departmentSchema from '~/schema/department';
import type { IDepartment } from '~/types/organization';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';

export function createDepartmentModel(
  mongoose: typeof import('mongoose'),
): Model<IDepartment> {
  applyTenantIsolation(departmentSchema);

  return (
    mongoose.models.Department ||
    mongoose.model<IDepartment>('Department', departmentSchema)
  );
}
