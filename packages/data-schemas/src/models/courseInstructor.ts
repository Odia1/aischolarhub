import type { Model } from 'mongoose';
import courseInstructorSchema from '~/schema/courseInstructor';
import type { ICourseInstructor } from '~/types/organization';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';

export function createCourseInstructorModel(
  mongoose: typeof import('mongoose'),
): Model<ICourseInstructor> {
  applyTenantIsolation(courseInstructorSchema);

  return (
    mongoose.models.CourseInstructor ||
    mongoose.model<ICourseInstructor>(
      'CourseInstructor',
      courseInstructorSchema,
    )
  );
}
