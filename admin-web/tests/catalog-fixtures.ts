import type { Genre } from '../src/features/stories/model';
import type { AdminComment } from '../src/features/comments/model';
export const genre: Genre = {
  id: '30000000-0000-4000-8000-000000000001',
  name: 'Phiêu lưu',
  slug: 'phieu-luu',
};
export const catalogStoryId = '20000000-0000-4000-8000-000000000001';
export const rootComment: AdminComment = {
  id: '50000000-0000-4000-8000-000000000001',
  storyId: catalogStoryId,
  parentId: null,
  content: 'Một câu chuyện thú vị.\nMong chờ chương tiếp theo.',
  status: 'VISIBLE',
  user: { username: 'qa_reader', displayName: 'Độc giả QA', avatarUrl: null },
  story: {
    id: catalogStoryId,
    title: 'Truyện kiểm thử kiểm duyệt',
    slug: 'test-story',
    publishStatus: 'PUBLISHED',
  },
  parent: null,
  replyCount: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};
export const replyComment: AdminComment = {
  ...rootComment,
  id: '50000000-0000-4000-8000-000000000002',
  parentId: rootComment.id,
  content: 'Đồng ý với bạn.',
  parent: { id: rootComment.id, status: 'VISIBLE', user: rootComment.user },
  replyCount: 0,
  status: 'HIDDEN',
  createdAt: '2026-01-02T00:00:00Z',
};
