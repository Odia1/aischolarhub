import type { Document } from 'mongoose';

export type InstitutionStatus = 'enabled' | 'disabled';

export interface IInstitution extends Document {
  /** Canonical tenant identifier; stored as Mongo _id to avoid two tenancy keys. */
  _id: string;
  name: string;
  status: InstitutionStatus;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CreateInstitutionInput {
  id: string;
  name: string;
}

export interface UpdateInstitutionInput {
  name?: string;
  status?: InstitutionStatus;
}
