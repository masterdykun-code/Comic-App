import { Navigate, Outlet, Route, Routes } from 'react-router';
import { useAuth } from '../features/auth/auth-context';
import { LoginPage } from '../pages/LoginPage';
import { DashboardPage } from '../pages/DashboardPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { AdminLayout } from '../layouts/AdminLayout';
import { StoriesPage } from '../features/stories/StoriesPage';
import { EpubImportPage } from '../features/stories/EpubImportPage';
import { StoryFormPage } from '../features/stories/StoryFormPage';
import { StoryDetailPage } from '../features/stories/StoryDetailPage';
import { ChapterListPage } from '../features/chapters/ChapterListPage';
import { ChapterDetailPage } from '../features/chapters/ChapterDetailPage';
import { ChapterFormPage } from '../features/chapters/ChapterFormPage';
import { GenresPage } from '../features/genres/GenresPage';
import { CommentsPage } from '../features/comments/CommentsPage';
import { UsersPage, UserDetailPage } from '../features/users/UsersPage';
function ProtectedRoute() {
  const { view } = useAuth();
  if (
    view.status !== 'authenticated' ||
    view.user?.role !== 'ADMIN' ||
    view.user.status !== 'ACTIVE'
  )
    return <Navigate to="/login" replace />;
  return <Outlet />;
}
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AdminLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/users/:id" element={<UserDetailPage />} />
          <Route path="/genres" element={<GenresPage />} />
          <Route path="/comments" element={<CommentsPage />} />
          <Route path="/stories" element={<StoriesPage />} />
          <Route path="/stories/new" element={<StoryFormPage />} />
          <Route path="/stories/import-epub" element={<EpubImportPage />} />
          <Route path="/stories/:id" element={<StoryDetailPage />} />
          <Route path="/stories/:id/edit" element={<StoryFormPage edit />} />
          <Route path="/stories/:storyId/chapters" element={<ChapterListPage />} />
          <Route path="/stories/:storyId/chapters/new" element={<ChapterFormPage />} />
          <Route path="/stories/:storyId/chapters/:chapterId" element={<ChapterDetailPage />} />
          <Route
            path="/stories/:storyId/chapters/:chapterId/edit"
            element={<ChapterFormPage edit />}
          />
        </Route>
      </Route>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
