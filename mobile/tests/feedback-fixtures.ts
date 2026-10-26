import type { Rating, Thread, Comment, Summary } from '../src/features/feedback/api';
import { novel } from './catalog-fixtures';
import { user } from './fixtures';
export const author = { username: user.username, displayName: user.displayName, avatarUrl: null };
export const rating: Rating = {
  id: '50000000-0000-4000-8000-000000000001',
  storyId: novel.id,
  score: 4,
  reviewText: 'Một câu chuyện ấm áp.',
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
  user: author,
};
export const comment: Comment = {
  id: '60000000-0000-4000-8000-000000000001',
  storyId: novel.id,
  parentId: null,
  content: 'Bình luận của tôi',
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
  user: author,
};
export const reply: Comment = {
  ...comment,
  id: '60000000-0000-4000-8000-000000000002',
  parentId: comment.id,
  content: 'Phản hồi của bạn đọc',
  user: { ...author, username: 'another_reader', displayName: 'Người đọc khác' },
};
export const thread: Thread = {
  ...comment,
  replies: [reply],
  repliesPagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
};
export const summary: Summary = {
  averageScore: 4,
  totalRatings: 1,
  distribution: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 0 },
};
export const feedbackPage = <T>(data: T[], page = 1, total = data.length, limit = 20) => ({
  data,
  pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
});
export const ratingPage = (
  data: Rating[] = [rating],
  page = 1,
  total = data.length,
  limit = 20,
) => ({
  ...feedbackPage(data, page, total, limit),
  summary: data.length
    ? summary
    : { averageScore: null, totalRatings: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } },
});
