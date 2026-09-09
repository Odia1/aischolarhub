import { readRagSelection, writeRagSelection } from './ragSelection';

describe('RAG selection preference', () => {
  beforeEach(() => window.localStorage.clear());

  it('defaults to enabled personal knowledge', () => {
    expect(readRagSelection('user-a')).toEqual({
      enabled: true,
      selectedPointKeys: ['PERSONAL'],
    });
  });

  it('round-trips and de-duplicates selected RAG Points per user', () => {
    writeRagSelection(
      {
        enabled: true,
        selectedPointKeys: ['PERSONAL', 'INSTITUTION:SEEDS', 'INSTITUTION:SEEDS'],
      },
      'user-a',
    );

    expect(readRagSelection('user-a')).toEqual({
      enabled: true,
      selectedPointKeys: ['PERSONAL', 'INSTITUTION:SEEDS'],
    });
    expect(readRagSelection('user-b').selectedPointKeys).toEqual(['PERSONAL']);
  });

  it('rejects expired browser preferences', () => {
    writeRagSelection(
      { enabled: true, selectedPointKeys: ['INSTITUTION:SEEDS'] },
      'user-a',
    );
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 5 * 60 * 60 * 1000);

    expect(readRagSelection('user-a').selectedPointKeys).toEqual(['PERSONAL']);
  });
});
