import { Schema } from 'mongoose';
import type { IGroupCourse } from '~/types/organization';

const groupCourseSchema = new Schema<IGroupCourse>(
  {
    tenantId: {
      type: String,
      required: true,
      index: true,
    },
    groupId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    courseId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
  },
  { timestamps: true, collection: 'group_courses' },
);

groupCourseSchema.index(
  { tenantId: 1, groupId: 1, courseId: 1 },
  { unique: true },
);

groupCourseSchema.index({
  tenantId: 1,
  courseId: 1,
});

export default groupCourseSchema;
