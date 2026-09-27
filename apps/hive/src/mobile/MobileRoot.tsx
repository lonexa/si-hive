import { useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';
import { mobileRouter } from './mobile-router';
import './mobile.css';

export default function MobileRoot() {
  // Scopes the phone-only styles in mobile.css (dialogs, inputs, tab strips).
  useEffect(() => {
    document.documentElement.classList.add('hive-mobile');
    return () => document.documentElement.classList.remove('hive-mobile');
  }, []);
  return <RouterProvider router={mobileRouter} />;
}
