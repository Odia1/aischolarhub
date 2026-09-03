import type { Model } from 'mongoose';
import groupCourseSchema from '~/schema/groupCourse';
import type { IGroupCourse } from '~/types/organization';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';

export function createGroupCourseModel(
  mongoose: typeof import('mongoose'),
): Model<IGroupCourse> {
  applyTenantIsolation(groupCourseSchema);

  return (
    mongoose.models.GroupCourse ||
    mongoose.model<IGroupCourse>('GroupCourse', groupCourseSchema)
  );
}
