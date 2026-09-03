import type { Document, Types } from 'mongoose';

export type OrganizationStatus = 'active' | 'inactive';

export interface IDepartment extends Document {
  _id: Types.ObjectId;
  tenantId: string;
  name: string;
  description?: string;
  status: OrganizationStatus;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ICourse extends Document {
  _id: Types.ObjectId;
  tenantId: string;
  departmentId: Types.ObjectId;
  code: string;
  name: string;
  description?: string;
  status: OrganizationStatus;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IGroupDepartment extends Document {
  _id: Types.ObjectId;
  tenantId: string;
  groupId: Types.ObjectId;
  departmentId: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IGroupCourse extends Document {
  _id: Types.ObjectId;
  tenantId: string;
  groupId: Types.ObjectId;
  courseId: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ICourseInstructor extends Document {
  _id: Types.ObjectId;
  tenantId: string;
  courseId: Types.ObjectId;
  userId: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CreateDepartmentInput {
  name: string;
  description?: string;
  status?: OrganizationStatus;
}

export interface UpdateDepartmentInput {
  name?: string;
  description?: string;
  status?: OrganizationStatus;
}

export interface CreateCourseInput {
  departmentId: Types.ObjectId | string;
  code: string;
  name: string;
  description?: string;
  status?: OrganizationStatus;
}

export interface UpdateCourseInput {
  departmentId?: Types.ObjectId | string;
  code?: string;
  name?: string;
  description?: string;
  status?: OrganizationStatus;
}
