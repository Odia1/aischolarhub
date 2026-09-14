import { randomUUID } from 'node:crypto';
import type { Model, Types } from 'mongoose';
import type {
  ISupportKnowledge,
  SupportKnowledgeAudience,
  SupportKnowledgeCategory,
} from '~/types';

const DEFAULT_PUBLISHED_LIMIT = 50;
const MAX_PUBLISHED_LIMIT = 200;

export type CreateSupportKnowledgeDraftInput = {
  title: string;
  description?: string;
  category?: SupportKnowledgeCategory;
  audience?: SupportKnowledgeAudience[];
  content: string;
  effectiveAt?: Date;
  actorId: string;
};

export type UpdateSupportKnowledgeDraftInput = {
  title?: string;
  description?: string;
  category?: SupportKnowledgeCategory;
  audience?: SupportKnowledgeAudience[];
  content?: string;
  effectiveAt?: Date | null;
  actorId: string;
};

export type PublishedSupportKnowledgeQuery = {
  category?: SupportKnowledgeCategory;
  audience?: SupportKnowledgeAudience;
  limit?: number;
  now?: Date;
};

export class SupportKnowledgeConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SupportKnowledgeConflictError';
  }
}

export class SupportKnowledgeNotFoundError extends Error {
  constructor(message = 'Support Knowledge document not found') {
    super(message);
    this.name = 'SupportKnowledgeNotFoundError';
  }
}

function cleanActor(actorId: string): string {
  const value = String(actorId || '').trim();
  if (!value) {
    throw new Error('actorId is required');
  }
  return value;
}

export function createSupportKnowledgeMethods(
  mongoose: typeof import('mongoose'),
): {
  listSupportKnowledge: () => Promise<ISupportKnowledge[]>;
  getSupportKnowledgeById: (
    id: string | Types.ObjectId,
  ) => Promise<ISupportKnowledge | null>;
  createSupportKnowledgeDraft: (
    input: CreateSupportKnowledgeDraftInput,
  ) => Promise<ISupportKnowledge>;
  updateSupportKnowledgeDraft: (
    id: string | Types.ObjectId,
    input: UpdateSupportKnowledgeDraftInput,
  ) => Promise<ISupportKnowledge>;
  createSupportKnowledgeRevision: (
    id: string | Types.ObjectId,
    actorId: string,
  ) => Promise<ISupportKnowledge>;
  publishSupportKnowledge: (
    id: string | Types.ObjectId,
    actorId: string,
  ) => Promise<ISupportKnowledge>;
  retireSupportKnowledge: (
    id: string | Types.ObjectId,
    actorId: string,
  ) => Promise<ISupportKnowledge>;
  getPublishedSupportKnowledge: (
    query?: PublishedSupportKnowledgeQuery,
  ) => Promise<ISupportKnowledge[]>;
} {
  function model(): Model<ISupportKnowledge> {
    return mongoose.models.SupportKnowledge as Model<ISupportKnowledge>;
  }

  async function listSupportKnowledge(): Promise<ISupportKnowledge[]> {
    return model()
      .find({})
      .sort({ updatedAt: -1, knowledgeKey: 1, revision: -1 })
      .lean<ISupportKnowledge[]>()
      .exec();
  }

  async function getSupportKnowledgeById(
    id: string | Types.ObjectId,
  ): Promise<ISupportKnowledge | null> {
    return model().findById(id).lean<ISupportKnowledge>().exec();
  }

  async function createSupportKnowledgeDraft(
    input: CreateSupportKnowledgeDraftInput,
  ): Promise<ISupportKnowledge> {
    const actorId = cleanActor(input.actorId);

    const doc = await model().create({
      knowledgeKey: randomUUID(),
      revision: 1,
      status: 'DRAFT',
      title: input.title,
      description: input.description,
      category: input.category ?? 'OTHER',
      audience: input.audience?.length ? input.audience : ['ALL'],
      content: input.content,
      ...(input.effectiveAt !== undefined
        ? { effectiveAt: input.effectiveAt }
        : {}),
      createdBy: actorId,
      updatedBy: actorId,
    });

    return doc.toObject() as ISupportKnowledge;
  }

  async function updateSupportKnowledgeDraft(
    id: string | Types.ObjectId,
    input: UpdateSupportKnowledgeDraftInput,
  ): Promise<ISupportKnowledge> {
    const actorId = cleanActor(input.actorId);

    const set: Record<string, unknown> = {
      updatedBy: actorId,
    };

    if (input.title !== undefined) {
      set.title = input.title;
    }
    if (input.description !== undefined) {
      set.description = input.description;
    }
    if (input.category !== undefined) {
      set.category = input.category;
    }
    if (input.audience !== undefined) {
      set.audience = input.audience.length ? input.audience : ['ALL'];
    }
    if (input.content !== undefined) {
      set.content = input.content;
    }
    if (input.effectiveAt !== undefined) {
      set.effectiveAt = input.effectiveAt;
    }

    const updated = await model()
      .findOneAndUpdate(
        {
          _id: id,
          status: 'DRAFT',
        },
        { $set: set },
        {
          new: true,
          runValidators: true,
        },
      )
      .lean<ISupportKnowledge>()
      .exec();

    if (updated) {
      return updated;
    }

    const existing = await model()
      .findById(id)
      .select('_id status')
      .lean<Pick<ISupportKnowledge, '_id' | 'status'>>()
      .exec();

    if (!existing) {
      throw new SupportKnowledgeNotFoundError();
    }

    throw new SupportKnowledgeConflictError(
      'Only DRAFT Support Knowledge documents may be edited',
    );
  }

  async function createSupportKnowledgeRevision(
    id: string | Types.ObjectId,
    actorIdInput: string,
  ): Promise<ISupportKnowledge> {
    const actorId = cleanActor(actorIdInput);
    const source = await getSupportKnowledgeById(id);

    if (!source) {
      throw new SupportKnowledgeNotFoundError();
    }

    if (source.status === 'DRAFT') {
      throw new SupportKnowledgeConflictError(
        'A DRAFT document should be edited directly rather than revised',
      );
    }

    const existingDraft = await model()
      .findOne({
        knowledgeKey: source.knowledgeKey,
        status: 'DRAFT',
      })
      .lean<ISupportKnowledge>()
      .exec();

    if (existingDraft) {
      throw new SupportKnowledgeConflictError(
        'A DRAFT revision already exists for this Support Knowledge document',
      );
    }

    const latest = await model()
      .findOne({ knowledgeKey: source.knowledgeKey })
      .sort({ revision: -1 })
      .select('revision')
      .lean<Pick<ISupportKnowledge, 'revision'>>()
      .exec();

    const nextRevision = (latest?.revision ?? source.revision) + 1;

    const doc = await model().create({
      knowledgeKey: source.knowledgeKey,
      revision: nextRevision,
      status: 'DRAFT',
      title: source.title,
      description: source.description,
      category: source.category,
      audience: source.audience,
      content: source.content,
      effectiveAt: source.effectiveAt,
      sourceRevisionId: source._id,
      createdBy: actorId,
      updatedBy: actorId,
    });

    return doc.toObject() as ISupportKnowledge;
  }

  async function publishSupportKnowledge(
    id: string | Types.ObjectId,
    actorIdInput: string,
  ): Promise<ISupportKnowledge> {
    const actorId = cleanActor(actorIdInput);
    const draft = await getSupportKnowledgeById(id);

    if (!draft) {
      throw new SupportKnowledgeNotFoundError();
    }

    if (draft.status !== 'DRAFT') {
      throw new SupportKnowledgeConflictError(
        'Only DRAFT Support Knowledge documents may be published',
      );
    }

    const now = new Date();

    /**
     * Superseded published revisions are retained for history but retired so
     * they cannot be selected for new Support answers.
     */
    await model()
      .updateMany(
        {
          knowledgeKey: draft.knowledgeKey,
          status: 'PUBLISHED',
          _id: { $ne: draft._id },
        },
        {
          $set: {
            status: 'RETIRED',
            retiredAt: now,
            retiredBy: actorId,
            updatedBy: actorId,
          },
        },
        { runValidators: true },
      )
      .exec();

    const published = await model()
      .findOneAndUpdate(
        {
          _id: draft._id,
          status: 'DRAFT',
        },
        {
          $set: {
            status: 'PUBLISHED',
            publishedAt: now,
            publishedBy: actorId,
            updatedBy: actorId,
          },
          $unset: {
            retiredAt: 1,
            retiredBy: 1,
          },
        },
        {
          new: true,
          runValidators: true,
        },
      )
      .lean<ISupportKnowledge>()
      .exec();

    if (!published) {
      throw new SupportKnowledgeConflictError(
        'Support Knowledge document changed before publication completed',
      );
    }

    return published;
  }

  async function retireSupportKnowledge(
    id: string | Types.ObjectId,
    actorIdInput: string,
  ): Promise<ISupportKnowledge> {
    const actorId = cleanActor(actorIdInput);
    const now = new Date();

    const retired = await model()
      .findOneAndUpdate(
        {
          _id: id,
          status: 'PUBLISHED',
        },
        {
          $set: {
            status: 'RETIRED',
            retiredAt: now,
            retiredBy: actorId,
            updatedBy: actorId,
          },
        },
        {
          new: true,
          runValidators: true,
        },
      )
      .lean<ISupportKnowledge>()
      .exec();

    if (retired) {
      return retired;
    }

    const existing = await getSupportKnowledgeById(id);

    if (!existing) {
      throw new SupportKnowledgeNotFoundError();
    }

    throw new SupportKnowledgeConflictError(
      'Only PUBLISHED Support Knowledge documents may be retired',
    );
  }

  async function getPublishedSupportKnowledge(
    query: PublishedSupportKnowledgeQuery = {},
  ): Promise<ISupportKnowledge[]> {
    const now = query.now ?? new Date();
    const requestedLimit = Number.isFinite(query.limit)
      ? Math.trunc(query.limit as number)
      : DEFAULT_PUBLISHED_LIMIT;
    const limit = Math.max(
      1,
      Math.min(MAX_PUBLISHED_LIMIT, requestedLimit),
    );

    const filter: Record<string, unknown> = {
      status: 'PUBLISHED',
      $or: [
        { effectiveAt: { $exists: false } },
        { effectiveAt: null },
        { effectiveAt: { $lte: now } },
      ],
    };

    if (query.category) {
      filter.category = query.category;
    }

    if (query.audience && query.audience !== 'ALL') {
      filter.audience = {
        $in: ['ALL', query.audience],
      };
    }

    return model()
      .find(filter)
      .sort({ updatedAt: -1, knowledgeKey: 1, revision: -1 })
      .limit(limit)
      .lean<ISupportKnowledge[]>()
      .exec();
  }

  return {
    listSupportKnowledge,
    getSupportKnowledgeById,
    createSupportKnowledgeDraft,
    updateSupportKnowledgeDraft,
    createSupportKnowledgeRevision,
    publishSupportKnowledge,
    retireSupportKnowledge,
    getPublishedSupportKnowledge,
  };
}

export type SupportKnowledgeMethods = ReturnType<
  typeof createSupportKnowledgeMethods
>;
