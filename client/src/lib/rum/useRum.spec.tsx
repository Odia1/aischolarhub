import { renderHook } from '@testing-library/react';
import useRum from './useRum';

describe('useRum', () => {
  it('remains safely disabled when rendered', () => {
    expect(() => renderHook(() => useRum())).not.toThrow();
  });
});
