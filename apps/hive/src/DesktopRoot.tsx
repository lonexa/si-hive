import { RouterProvider } from 'react-router-dom';
import { router } from './router';

export default function DesktopRoot() {
  return <RouterProvider router={router} />;
}
