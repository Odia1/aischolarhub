const express = require('express');
const request = require('supertest');

let mockUser;
let mockAuthenticated = true;

const mockGetInstitutionById = jest.fn();

jest.mock('~/models', () => ({
  getInstitutionById: (...args) => mockGetInstitutionById(...args),
}));

jest.mock('~/server/middleware/requireJwtAuth', () => (req, res, next) => {
  if (!mockAuthenticated) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  req.user = mockUser;
  next();
});

const supportRouter = require('./index');

const createApp = () => {
  const app = express();
  app.use('/api/support', supportRouter);
  return app;
};

describe('AIH Support context boundary', () => {
  beforeEach(() => {
    mockAuthenticated = true;
    mockUser = {
      id: 'internal-user-id',
      email: 'person@example.edu',
      tenantId: 'SEEDS',
      role: 'INSTRUCTOR',
      provider: 'google',
      secretValue: 'must-not-leak',
    };

    mockGetInstitutionById.mockReset();
    mockGetInstitutionById.mockResolvedValue({
      _id: 'SEEDS',
      name: 'SEEDS',
      status: 'enabled',
      authPolicy: {
        mode: 'LOCAL',
      },
      limits: {
        hiddenInternalLimit: 123,
      },
    });
  });

  test('rejects unauthenticated access', async () => {
    mockAuthenticated = false;

    const res = await request(createApp()).get('/api/support/context');

    expect(res.status).toBe(401);
  });

  test('returns only approved user-facing support context', async () => {
    const res = await request(createApp()).get('/api/support/context');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');

    expect(res.body).toEqual({
      authenticated: true,
      supportName: 'AIH Support',
      role: 'Instructor',
      institution: 'SEEDS',
      capabilities: {
        readOnly: true,
        supportDocumentation: true,
        escalationSummary: true,
      },
    });

    const serialized = JSON.stringify(res.body);

    for (const forbidden of [
      'internal-user-id',
      'person@example.edu',
      'tenantId',
      'SEEDS_INTERNAL',
      'provider',
      'google',
      'secretValue',
      'must-not-leak',
      'authPolicy',
      'hiddenInternalLimit',
      'model',
      'credential',
      'diagnostic',
      'log',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  test('uses only the authenticated tenant internally for institution lookup', async () => {
    await request(createApp()).get('/api/support/context');

    expect(mockGetInstitutionById).toHaveBeenCalledTimes(1);
    expect(mockGetInstitutionById).toHaveBeenCalledWith('SEEDS');
  });

  test('does not expose disabled institution details', async () => {
    mockGetInstitutionById.mockResolvedValue({
      _id: 'SEEDS',
      name: 'SEEDS Internal University',
      status: 'disabled',
    });

    const res = await request(createApp()).get('/api/support/context');

    expect(res.status).toBe(200);
    expect(res.body.institution).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain('SEEDS Internal University');
  });

  test('fails closed when institution lookup fails', async () => {
    mockGetInstitutionById.mockRejectedValue(
      new Error('database topology secret-internal-host:27017'),
    );

    const res = await request(createApp()).get('/api/support/context');

    expect(res.status).toBe(200);
    expect(res.body.institution).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain('secret-internal-host');
  });

  test('returns null institution for platform-scoped users', async () => {
    mockUser = {
      id: 'platform-user',
      role: 'PLATFORM_ADMIN',
    };

    const res = await request(createApp()).get('/api/support/context');

    expect(res.status).toBe(200);
    expect(res.body.role).toBe('Platform Admin');
    expect(res.body.institution).toBeNull();
    expect(mockGetInstitutionById).not.toHaveBeenCalled();
  });

  test('normalizes unexpected roles to User', async () => {
    mockUser.role = 'SOME_INTERNAL_ROLE';

    const res = await request(createApp()).get('/api/support/context');

    expect(res.status).toBe(200);
    expect(res.body.role).toBe('User');
    expect(JSON.stringify(res.body)).not.toContain('SOME_INTERNAL_ROLE');
  });
});
