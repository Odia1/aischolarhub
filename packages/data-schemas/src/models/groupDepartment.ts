import type { Model } from 'mongoose';
import groupDepartmentSchema from '~/schema/groupDepartment';
import type { IGroupDepartment } from '~/types/organization';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';

export function createGroupDepartmentModel(
  mongoose: typeof import('mongoose'),
): Model<IGroupDepartment> {
  applyTenantIsolation(groupDepartmentSchema);

  return (
    mongoose.models.GroupDepartment ||
    mongoose.model<IGroupDepartment>('GroupDepartment', groupDepartmentSchema)
  );
}
