import { Schema } from 'mongoose';
import type { ISupportKnowledge } from '~/types/supportKnowledge';
import {
  SUPPORT_KNOWLEDGE_AUDIENCES,
  SUPPORT_KNOWLEDGE_CATEGORIES,
  SUPPORT_KNOWLEDGE_STATUSES,
} from '~/types/supportKnowledge';

const supportKnowledgeSchema: Schema<ISupportKnowledge> = new Schema<ISupportKnowledge>(
  {
    knowledgeKey: {
      type: String,
      required: true,
      trim: true,
      maxlength: 128,
      index: true,
    },

    revision: {
      type: Number,
      required: true,
      min: 1,
    },

    status: {
      type: String,
      required: true,
      enum: SUPPORT_KNOWLEDGE_STATUSES,
      default: 'DRAFT',
      index: true,
    },

    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 240,
    },

    description: {
      type: String,
      trim: true,
      maxlength: 2000,
    },

    category: {
      type: String,
      required: true,
      enum: SUPPORT_KNOWLEDGE_CATEGORIES,
      default: 'OTHER',
      index: true,
    },

    audience: {
      type: [String],
      required: true,
      enum: SUPPORT_KNOWLEDGE_AUDIENCES,
      default: ['ALL'],
    },

    content: {
      type: String,
      required: true,
      maxlength: 500000,
    },

    effectiveAt: {
      type: Date,
    },

    sourceRevisionId: {
      type: Schema.Types.ObjectId,
    },

    createdBy: {
      type: String,
      required: true,
      maxlength: 256,
    },

    updatedBy: {
      type: String,
      required: true,
      maxlength: 256,
    },

    publishedAt: {
      type: Date,
    },

    publishedBy: {
      type: String,
      maxlength: 256,
    },

    retiredAt: {
      type: Date,
    },

    retiredBy: {
      type: String,
      maxlength: 256,
    },
  },
  {
    timestamps: true,
    minimize: false,
  },
);

supportKnowledgeSchema.index({ knowledgeKey: 1, revision: 1 }, { unique: true });

/**
 * Concurrency invariants:
 * one editable DRAFT and one active PUBLISHED revision per knowledge item.
 * RETIRED history remains unlimited.
 */
supportKnowledgeSchema.index(
  { knowledgeKey: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'DRAFT' },
    name: 'unique_support_knowledge_draft',
  },
);

supportKnowledgeSchema.index(
  { knowledgeKey: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'PUBLISHED' },
    name: 'unique_support_knowledge_published',
  },
);

supportKnowledgeSchema.index({ status: 1, category: 1, updatedAt: -1 });

export default supportKnowledgeSchema;
