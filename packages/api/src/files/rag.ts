import axios from 'axios';
import { logger } from '@librechat/data-schemas';
import { generateShortLivedToken } from '~/crypto/jwt';
import { canAccessRag, type InstitutionAdminActor } from '~/admin/institutionAuthorization';

interface DeleteRagFileParams {
  /** The authenticated actor performing the operation. */
  actor: InstitutionAdminActor;
  /** The file object. */
  file: {
    file_id: string;
    embedded?: boolean;
    tenantId?: string | null;
  };
}

/**
 * Deletes an embedded document from the RAG API.
 *
 * RAG resources are tenant-isolated. Institution-scoped actors may only
 * delete documents belonging to their own tenant. Platform and superadmin
 * actors may operate across tenants.
 *
 * The tenant check is deliberately performed before issuing the RAG request.
 */
export async function deleteRagFile({
  actor,
  file,
}: DeleteRagFileParams): Promise<boolean> {
  if (!file.embedded || !process.env.RAG_API_URL) {
    return true;
  }

  if (!actor?.id) {
    logger.error('[deleteRagFile] No authenticated user ID provided');
    return false;
  }

  if (!canAccessRag(actor, file.tenantId)) {
    logger.error(
      `[deleteRagFile] RAG access denied for user ${actor.id} and tenant ${file.tenantId ?? '<none>'}`,
    );
    return false;
  }

  const jwtToken = generateShortLivedToken(actor.id);

  try {
    await axios.delete(`${process.env.RAG_API_URL}/documents`, {
      headers: {
        Authorization: `Bearer ${jwtToken}`,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      data: [file.file_id],
    });

    logger.debug(
      `[deleteRagFile] Successfully deleted document ${file.file_id} from RAG API`,
    );
    return true;
  } catch (error) {
    const axiosError = error as { response?: { status?: number }; message?: string };

    if (axiosError.response?.status === 404) {
      logger.warn(
        `[deleteRagFile] Document ${file.file_id} not found in RAG API, may have been deleted already`,
      );
      return true;
    }

    logger.error(
      '[deleteRagFile] Error deleting document from RAG API:',
      axiosError.message,
    );
    return false;
  }
}
