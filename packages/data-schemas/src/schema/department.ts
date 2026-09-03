import { Schema } from 'mongoose';
import type { IDepartment } from '~/types/organization';

const departmentSchema = new Schema<IDepartment>(
  {
    tenantId: {
      type: String,
      required: true,
      index: true,
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
  { timestamps: true, collection: 'departments' },
);

departmentSchema.index({ tenantId: 1, name: 1 }, { unique: true });

export default departmentSchema;
