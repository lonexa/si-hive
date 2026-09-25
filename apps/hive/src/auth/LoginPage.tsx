import { useState, type FormEvent } from 'react';
import { Github, Globe, Building2, KeyRound, UserRound, type LucideIcon } from 'lucide-react';
import { useAuth } from './AuthProvider';

const ICONS: Record<string, LucideIcon> = { Github, Globe, Building2, KeyRound, UserRound };

export default function LoginPage() {
  const { login, loginWithPassword, providers } = useAuth();
  const [keepLoggedIn, setKeepLoggedIn] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const oauth = providers.filter((p) => p.type !== 'local');
  const hasPassword = providers.some((p) => p.type === 'local');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(await loginWithPassword(username, password, keepLoggedIn));
    setBusy(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm mx-auto p-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-foreground mb-2">SI Hive</h1>
          <p className="text-sm text-muted-foreground">Sign in to continue</p>
        </div>

        <div className="space-y-3">
          {oauth.map((p) => {
            const Icon = ICONS[p.icon] ?? KeyRound;
            return (
              <button
                key={p.id}
                onClick={() => login(keepLoggedIn, p.id)}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-md border border-border bg-secondary text-foreground font-medium hover:bg-secondary/70 transition-colors"
              >
                <Icon className="h-5 w-5" />
                Sign in with {p.label}
              </button>
            );
          })}

          {hasPassword && (
            <form onSubmit={(e) => void submit(e)} className="space-y-2 pt-1">
              {oauth.length > 0 && <div className="text-center text-xs text-muted-foreground py-1">or</div>}
              <input
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="Username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
              <input
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="Password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="submit"
                disabled={busy || !username || !password}
                className="w-full px-4 py-2.5 rounded-md bg-primary text-primary-foreground font-medium hover:bg-primary/90 disabled:opacity-50"
              >
                Sign in
              </button>
            </form>
          )}

          {error && <p className="text-sm text-destructive text-center">{error}</p>}

          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={keepLoggedIn}
              onChange={(e) => setKeepLoggedIn(e.target.checked)}
              className="rounded border-border"
            />
            Keep me signed in for 30 days
          </label>
        </div>
      </div>
    </div>
  );
}
