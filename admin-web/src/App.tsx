import { createBrowserRouter, RouterProvider } from 'react-router';
import { AppProviders } from './app/providers';
import { AppRoutes } from './routes/AppRoutes';
// Data router enables chapter forms to guard internal links and browser Back.
const router = createBrowserRouter([
  {
    path: '*',
    element: (
      <AppProviders>
        <AppRoutes />
      </AppProviders>
    ),
  },
]);
export default function App() {
  return <RouterProvider router={router} useTransitions={false} />;
}
