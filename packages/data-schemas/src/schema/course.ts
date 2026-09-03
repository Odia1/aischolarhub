import { Schema } from 'mongoose';
import type { ICourse } from '~/types/organization';

const courseSchema = new Schema<ICourse>(
  {
    tenantId: {
      type: String,
      required: true,
      index: true,
    },
    departmentId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      minlength: 1,
      maxlength: 100,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 200,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
      required: true,
      index: true,
    },
  },
  { timestamps: true, collection: 'courses' },
);

courseSchema.index({ tenantId: 1, code: 1 }, { unique: true });
courseSchema.index({ tenantId: 1, departmentId: 1, name: 1 });

export default courseSchema;
