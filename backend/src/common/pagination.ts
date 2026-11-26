export type PageRequest = { page?: number; pageSize?: number };
export type PageWindow = { page: number; pageSize: number; totalPages: number; skip: number };
export type PageResult<T> = { items: T[]; total: number; page: number; pageSize: number; totalPages: number };

export function pageWindow(request: PageRequest, total: number): PageWindow {
  const pageSize = Math.min(100, Math.max(1, request.pageSize || 10));
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, request.page || 1), totalPages);
  return { page, pageSize, totalPages, skip: (page - 1) * pageSize };
}

export function pageResult<T>(items: T[], total: number, window: PageWindow): PageResult<T> {
  return { items, total, page: window.page, pageSize: window.pageSize, totalPages: window.totalPages };
}
