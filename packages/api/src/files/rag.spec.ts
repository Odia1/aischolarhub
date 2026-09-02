import axios from 'axios';
import { deleteRagFile } from './rag';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('deleteRagFile', () => {
  const originalRagUrl = process.env.RAG_API_URL;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.RAG_API_URL = 'http://rag-api.test';
  });

  afterAll(() => {
    if (originalRagUrl === undefined) {
      delete process.env.RAG_API_URL;
    } else {
      process.env.RAG_API_URL = originalRagUrl;
    }
  });

  const tenantAFile = {
    file_id: 'file-123',
    embedded: true,
    tenantId: 'tenant-a',
  };

  const tenantBFile = {
    file_id: 'file-456',
    embedded: true,
    tenantId: 'tenant-b',
  };

  describe('tenant-isolated RAG deletion', () => {
    it('allows an Institution Admin to delete RAG content in its own tenant', async () => {
      mockedAxios.delete.mockResolvedValue({
        status: 200,
        data: {},
        headers: {},
        config: {},
      } as never);

      const result = await deleteRagFile({
        actor: {
          id: 'admin-a',
          role: 'INSTITUTION_ADMIN',
          tenantId: 'tenant-a',
        },
        file: tenantAFile,
      });

      expect(result).toBe(true);

      expect(mockedAxios.delete).toHaveBeenCalledWith(
        'http://rag-api.test/documents',
        expect.objectContaining({
          data: expect.objectContaining({
            file_id: 'file-123',
          }),
        }),
      );
    });

    it('allows a normal institution user to delete RAG content in its own tenant when authorized by the RAG capability layer', async () => {
      mockedAxios.delete.mockResolvedValue({
        status: 200,
        data: {},
        headers: {},
        config: {},
      } as never);

      const result = await deleteRagFile({
        actor: {
          id: 'user-a',
          role: 'USER',
          tenantId: 'tenant-a',
        },
        file: tenantAFile,
      });

      expect(result).toBe(true);

      expect(mockedAxios.delete).toHaveBeenCalled();
    });

    it('rejects cross-tenant RAG deletion', async () => {
      const result = await deleteRagFile({
        actor: {
          id: 'admin-a',
          role: 'INSTITUTION_ADMIN',
          tenantId: 'tenant-a',
        },
        file: tenantBFile,
      });

      expect(result).toBe(false);
      expect(mockedAxios.delete).not.toHaveBeenCalled();
    });

    it('rejects an institution-scoped actor without a tenant', async () => {
      const result = await deleteRagFile({
        actor: {
          id: 'admin-no-tenant',
          role: 'INSTITUTION_ADMIN',
          tenantId: undefined,
        },
        file: tenantAFile,
      });

      expect(result).toBe(false);
      expect(mockedAxios.delete).not.toHaveBeenCalled();
    });

    it('rejects an institution actor whose resource has no tenant', async () => {
      const result = await deleteRagFile({
        actor: {
          id: 'admin-a',
          role: 'INSTITUTION_ADMIN',
          tenantId: 'tenant-a',
        },
        file: {
          file_id: 'file-no-tenant',
          embedded: true,
          tenantId: undefined,
        },
      });

      expect(result).toBe(false);
      expect(mockedAxios.delete).not.toHaveBeenCalled();
    });

    it('skips deletion for non-embedded files', async () => {
      const result = await deleteRagFile({
        actor: {
          id: 'admin-a',
          role: 'INSTITUTION_ADMIN',
          tenantId: 'tenant-a',
        },
        file: {
          file_id: 'file-plain',
          embedded: false,
          tenantId: 'tenant-a',
        },
      });

      expect(result).toBe(true);
      expect(mockedAxios.delete).not.toHaveBeenCalled();
    });

    it('skips deletion when RAG_API_URL is not configured', async () => {
      delete process.env.RAG_API_URL;

      const result = await deleteRagFile({
        actor: {
          id: 'admin-a',
          role: 'INSTITUTION_ADMIN',
          tenantId: 'tenant-a',
        },
        file: tenantAFile,
      });

      expect(result).toBe(true);
      expect(mockedAxios.delete).not.toHaveBeenCalled();
    });

    it('treats a RAG 404 as already deleted', async () => {
      mockedAxios.delete.mockRejectedValue({
        response: {
          status: 404,
        },
      });

      const result = await deleteRagFile({
        actor: {
          id: 'admin-a',
          role: 'INSTITUTION_ADMIN',
          tenantId: 'tenant-a',
        },
        file: tenantAFile,
      });

      expect(result).toBe(true);
    });

    it('returns false on an actual RAG API failure', async () => {
      mockedAxios.delete.mockRejectedValue({
        response: {
          status: 500,
        },
      });

      const result = await deleteRagFile({
        actor: {
          id: 'admin-a',
          role: 'INSTITUTION_ADMIN',
          tenantId: 'tenant-a',
        },
        file: tenantAFile,
      });

      expect(result).toBe(false);
    });
  });
});
