import type { Model } from 'mongoose';
import type { ISupportKnowledge } from '~/types';
import supportKnowledgeSchema from '~/schema/supportKnowledge';

/**
 * Support Knowledge is platform-scoped, not tenant-owned course/RAG content.
 *
 * Deliberately do NOT apply tenant isolation here. Authorization is enforced
 * by the dedicated platform capability and the narrow published-only Support
 * retrieval path.
 */
export function createSupportKnowledgeModel(
  mongoose: typeof import('mongoose'),
): Model<ISupportKnowledge> {
  return (
    mongoose.models.SupportKnowledge ||
    mongoose.model<ISupportKnowledge>('SupportKnowledge', supportKnowledgeSchema)
  );
}
