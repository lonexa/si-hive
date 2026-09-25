import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const NAV_ROUTES = ['/', '/projects', '/sessions', '/terminal', '/agents', '/insights', '/history', '/plans', '/settings'];

interface Options {
  onCommandPalette: () => void;
}

export function useKeyboardShortcuts({ onCommandPalette }: Options) {
  const navigate = useNavigate();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const ctrl = e.ctrlKey || e.metaKey;

      // Don't intercept if typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        if (e.key === 'Escape') {
          (e.target as HTMLElement).blur();
        }
        return;
      }

      // Ctrl+K: Command palette
      if (ctrl && e.key === 'k') {
        e.preventDefault();
        onCommandPalette();
        return;
      }

      // Ctrl+N: New project
      if (ctrl && e.key === 'n') {
        e.preventDefault();
        navigate('/projects?new=true');
        return;
      }

      // Ctrl+T: New terminal
      if (ctrl && e.key === 't') {
        e.preventDefault();
        navigate('/sessions');
        return;
      }

      // Ctrl+1-9: Navigate to sidebar tabs
      if (ctrl && e.key >= '1' && e.key <= '9') {
        const idx = parseInt(e.key) - 1;
        if (idx < NAV_ROUTES.length) {
          e.preventDefault();
          navigate(NAV_ROUTES[idx]);
        }
        return;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate, onCommandPalette]);
}
