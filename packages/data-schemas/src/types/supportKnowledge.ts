import type { Types } from 'mongoose';

export const SUPPORT_KNOWLEDGE_STATUSES = ['DRAFT', 'PUBLISHED', 'RETIRED'] as const;

export type SupportKnowledgeStatus = (typeof SUPPORT_KNOWLEDGE_STATUSES)[number];

export const SUPPORT_KNOWLEDGE_CATEGORIES = [
  'GETTING_STARTED',
  'RAG',
  'ACADEMIC_AGENTS',
  'INSTRUCTOR_WORKFLOWS',
  'INSTITUTION_ADMINISTRATION',
  'TROUBLESHOOTING',
  'SECURITY_PRIVACY',
  'OTHER',
] as const;

export type SupportKnowledgeCategory = (typeof SUPPORT_KNOWLEDGE_CATEGORIES)[number];

export const SUPPORT_KNOWLEDGE_AUDIENCES = [
  'ALL',
  'STUDENT',
  'INSTRUCTOR',
  'RESEARCHER',
  'INSTITUTION_ADMIN',
  'PLATFORM_ADMIN',
] as const;

export type SupportKnowledgeAudience = (typeof SUPPORT_KNOWLEDGE_AUDIENCES)[number];

export interface ISupportKnowledge {
  _id: Types.ObjectId;

  /**
   * Stable lineage identifier shared by all revisions of one logical
   * Support Knowledge document.
   */
  knowledgeKey: string;

  /** Monotonically increasing revision within a knowledgeKey lineage. */
  revision: number;

  status: SupportKnowledgeStatus;

  title: string;
  description?: string;
  category: SupportKnowledgeCategory;
  audience: SupportKnowledgeAudience[];

  /**
   * Approved user-facing support content.
   *
   * In Release F2 this is stored as inert text. File ingestion and RAG
   * indexing are intentionally separate future security-gated stages.
   */
  content: string;

  /** Optional date from which a published revision is eligible for use. */
  effectiveAt?: Date;

  /** Revision from which this draft was created, when applicable. */
  sourceRevisionId?: Types.ObjectId;

  createdBy: string;
  updatedBy: string;

  publishedAt?: Date;
  publishedBy?: string;

  retiredAt?: Date;
  retiredBy?: string;

  createdAt: Date;
  updatedAt: Date;
}
