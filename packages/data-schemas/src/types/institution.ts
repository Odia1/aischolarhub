import type { Document } from 'mongoose';

export type InstitutionStatus = 'enabled' | 'disabled';

export interface IInstitutionRegionalContext {
  enabled?: boolean;
  countryCode?: string;
  country?: string;
  regionCode?: string;
  region?: string;
  city?: string;
  timezone?: string;
  locale?: string;
  currency?: string;
  educationSystem?: string;
  languages?: string[];
  developmentContext?: string;
}
export type InstitutionCategory = 'SCHOOL' | 'HIGHER_EDUCATION' | 'MIXED';

export interface IInstitution extends Document {
  /** Canonical tenant identifier; stored as Mongo _id to avoid two tenancy keys. */
  _id: string;
  name: string;
  status: InstitutionStatus;
  regionalContext?: IInstitutionRegionalContext;
  category: InstitutionCategory;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CreateInstitutionInput {
  id: string;
  name: string;
  category?: InstitutionCategory;
}

export interface UpdateInstitutionInput {
  name?: string;
  status?: InstitutionStatus;
  category?: InstitutionCategory;
}
