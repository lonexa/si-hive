import { useEffect } from 'react';

/**
 * Shared theme effect — applies the theme class to the document root.
 * Each app provides its own theme state source and wraps this.
 */
export function useThemeEffect(theme: 'dark' | 'light') {
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'light') {
      root.classList.add('light');
    } else {
      root.classList.remove('light');
    }
    localStorage.setItem('hive-theme', theme);
  }, [theme]);

  return theme;
}

export function getStoredTheme(): 'dark' | 'light' {
  return (localStorage.getItem('hive-theme') as 'dark' | 'light') || 'dark';
}
