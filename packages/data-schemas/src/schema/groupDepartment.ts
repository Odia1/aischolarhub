import { Schema } from 'mongoose';
import type { IGroupDepartment } from '~/types/organization';

const groupDepartmentSchema = new Schema<IGroupDepartment>(
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
    departmentId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
  },
  { timestamps: true, collection: 'group_departments' },
);

groupDepartmentSchema.index(
  { tenantId: 1, groupId: 1, departmentId: 1 },
  { unique: true },
);

groupDepartmentSchema.index({
  tenantId: 1,
  departmentId: 1,
});

export default groupDepartmentSchema;
