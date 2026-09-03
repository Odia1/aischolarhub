import type { Model } from 'mongoose';
import courseSchema from '~/schema/course';
import type { ICourse } from '~/types/organization';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';

export function createCourseModel(
  mongoose: typeof import('mongoose'),
): Model<ICourse> {
  applyTenantIsolation(courseSchema);

  return (
    mongoose.models.Course ||
    mongoose.model<ICourse>('Course', courseSchema)
  );
}
