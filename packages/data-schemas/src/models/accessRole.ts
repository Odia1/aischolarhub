import { Model } from 'mongoose';
import type * as t from '~/types';
import accessRoleSchema from '~/schema/accessRole';

export function createAccessRoleModel(mongoose: typeof import('mongoose')): Model<t.IAccessRole> {
  // AccessRole contains global Viewer/Editor/Owner templates.
  // Tenant isolation would hide these templates during tenant-bound requests.
  return (
    mongoose.models.AccessRole || mongoose.model<t.IAccessRole>('AccessRole', accessRoleSchema)
  );
}
