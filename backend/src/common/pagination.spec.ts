import { pageResult, pageWindow } from './pagination';

describe('pagination helpers', () => {
  it('clamps page size and page bounds while keeping an empty collection on page one', () => {
    expect(pageWindow({ page: 4, pageSize: 10 }, 21)).toEqual({ page: 3, pageSize: 10, totalPages: 3, skip: 20 });
    expect(pageWindow({ page: 7, pageSize: 1000 }, 0)).toEqual({ page: 1, pageSize: 100, totalPages: 1, skip: 0 });
  });

  it('returns the shared paged response shape', () => {
    const window = pageWindow({ page: 2, pageSize: 2 }, 3);
    expect(pageResult(['c'], 3, window)).toEqual({ items: ['c'], total: 3, page: 2, pageSize: 2, totalPages: 2 });
  });
});
