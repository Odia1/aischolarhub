import { Schema } from 'mongoose';
import type { ICourseInstructor } from '~/types/organization';

const courseInstructorSchema = new Schema<ICourseInstructor>(
  {
    tenantId: {
      type: String,
      required: true,
      index: true,
    },
    courseId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
  },
  { timestamps: true, collection: 'course_instructors' },
);

courseInstructorSchema.index(
  { tenantId: 1, courseId: 1, userId: 1 },
  { unique: true },
);

courseInstructorSchema.index({
  tenantId: 1,
  userId: 1,
});

export default courseInstructorSchema;
