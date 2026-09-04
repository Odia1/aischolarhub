const mongoose = require('mongoose');
const { logger } = require('@librechat/data-schemas');

function extractText(message) {
  if (!message) {
    return '';
  }

  if (typeof message.text === 'string') {
    return message.text.trim();
  }

  if (!Array.isArray(message.content)) {
    return '';
  }

  return message.content
    .map((part) => {
      if (typeof part?.text === 'string') {
        return part.text;
      }

      if (typeof part?.content === 'string') {
        return part.content;
      }

      return '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function compact(text, max = 800) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();

  if (value.length <= max) {
    return value;
  }

  return value.slice(0, max - 1) + '…';
}

/**
 * Records evidence from a completed Academic Agent interaction.
 *
 * Important:
 * - This does NOT infer or promote mastery.
 * - Mastery must ultimately be based on demonstrated learner evidence.
 * - Existing manually/admin-set learner-state fields are preserved.
 */
async function updateLearnerStateFromTurn({
  req,
  modelSpecName,
  userMessage,
  assistantMessage,
}) {
  try {
    const tenantId = String(req?.user?.tenantId || '').trim();
    const userId = String(req?.user?.id || '').trim();
    const spec = String(modelSpecName || '').trim();

    if (
      !tenantId ||
      !userId ||
      !spec ||
      mongoose.connection.readyState !== 1 ||
      !mongoose.connection.db
    ) {
      return;
    }

    const mongo = mongoose.connection.db;

    const agent = await mongo.collection('academicAgents').findOne({
      tenantId,
      modelSpecName: spec,
      enabled: { $ne: false },
    });

    if (!agent) {
      return;
    }

    const learnerText = compact(extractText(userMessage));
    const assistantText = compact(extractText(assistantMessage));

    if (!learnerText && !assistantText) {
      return;
    }

    const now = new Date();

    const evidence = {
      at: now,
      agentId: String(agent.agentId || '').trim(),
      modelSpecName: spec,
      conversationId: String(
        assistantMessage?.conversationId ||
          userMessage?.conversationId ||
          ''
      ).trim(),
      userMessageId: String(userMessage?.messageId || '').trim(),
      assistantMessageId: String(
        assistantMessage?.messageId || ''
      ).trim(),
      learnerText,
    };

    const setFields = {
      tenantId,
      userId,

      lastAgentId: String(agent.agentId || '').trim(),
      lastModelSpecName: spec,

      lastConversationId: evidence.conversationId,
      lastUserMessageId: evidence.userMessageId,
      lastAssistantMessageId: evidence.assistantMessageId,

      lastInteractionAt: now,
      updatedAt: now,
    };

    /*
     * currentFocus is deliberately separate from currentObjective.
     * currentObjective may be explicitly defined by the learner/admin.
     * A conversational turn must not silently overwrite that objective.
     */
    if (learnerText) {
      setFields.currentFocus = learnerText;
    }

    await mongo.collection('learnerStates').updateOne(
      {
        tenantId,
        userId,
      },
      {
        $set: setFields,

        $setOnInsert: {
          createdAt: now,
          masteryLevel: 'UNKNOWN',
          supportLevel: 'ADAPTIVE',
          currentObjective: '',
          preferredLanguage: '',
        },

        $inc: {
          interactionCount: 1,
        },

        $push: {
          evidence: {
            $each: [evidence],
            $slice: -20,
          },
        },
      },
      {
        upsert: true,
      },
    );
  } catch (error) {
    /*
     * Learner-state persistence must never break the chat response.
     */
    logger.error(
      '[academicIntelligence] learner-state update failed:',
      error,
    );
  }
}

module.exports = {
  updateLearnerStateFromTurn,
};
