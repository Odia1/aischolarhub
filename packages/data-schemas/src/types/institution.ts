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

export interface IInstitutionLimits {
  /** Maximum institution-scoped accounts. Undefined/null means unlimited. */
  maxAccounts?: number | null;

  /** Maximum prompt + completion tokens per UTC calendar month. */
  monthlyTokens?: number | null;
}

export type InstitutionAuthMode =
  | 'LOCAL'
  | 'SSO_OPTIONAL'
  | 'SSO_REQUIRED';

export type InstitutionAuthProvider =
  | 'GOOGLE'
  | 'MICROSOFT_ENTRA';

export type InstitutionProvisioningMode =
  | 'PREPROVISIONED_ONLY';

export interface IInstitutionAuthPolicy {
  /**
   * LOCAL:
   *   Institution permits local/password authentication.
   *
   * SSO_OPTIONAL:
   *   Institution permits SSO while retaining local authentication.
   *
   * SSO_REQUIRED:
   *   Institution-managed users must authenticate using the configured IdP.
   */
  mode: InstitutionAuthMode;

  /** Identity provider used for institutional SSO. */
  provider?: InstitutionAuthProvider | null;

  /**
   * Email domains used only for institution/IdP routing.
   * Possessing an address in one of these domains never grants AIH access.
   */
  domains?: string[];

  /**
   * Release E intentionally supports only PREPROVISIONED_ONLY.
   * Successful IdP authentication must resolve to an existing AIH account.
   */
  provisioning: InstitutionProvisioningMode;

  /**
   * Required for Microsoft Entra deployments when SSO is enabled.
   * AIH will later validate the token tenant/issuer against this value.
   */
  entraTenantId?: string | null;
}

export interface IInstitution extends Document {
  /** Canonical tenant identifier; stored as Mongo _id to avoid two tenancy keys. */
  _id: string;
  name: string;
  status: InstitutionStatus;
  regionalContext?: IInstitutionRegionalContext;
  category: InstitutionCategory;
  limits?: IInstitutionLimits;
  authPolicy?: IInstitutionAuthPolicy;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CreateInstitutionInput {
  id: string;
  name: string;
  category?: InstitutionCategory;
  limits?: IInstitutionLimits;
  authPolicy?: IInstitutionAuthPolicy;
}

export interface UpdateInstitutionInput {
  name?: string;
  status?: InstitutionStatus;
  category?: InstitutionCategory;
  limits?: IInstitutionLimits;
  authPolicy?: IInstitutionAuthPolicy;
}
