import { useState } from 'react';
import { Mail, Loader2, ExternalLink } from 'lucide-react';
import { Button } from '@hive/shared/components/ui/button';
import { Card, CardContent } from '@hive/shared/components/ui/card';
import { API_BASE } from '@/lib/api-config';

export default function ConnectPrompt() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAuthenticate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/gmail/auth/url`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.url) {
        window.open(data.url, '_blank');
      } else {
        throw new Error('No authentication URL returned');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to get authentication URL');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-center h-64">
      <Card className="max-w-md w-full">
        <CardContent className="flex flex-col items-center text-center pt-6 pb-6 space-y-4">
          <Mail className="h-12 w-12 text-muted-foreground opacity-50" />
          <div className="space-y-1">
            <h3 className="text-lg font-semibold">Connect Gmail</h3>
            <p className="text-sm text-muted-foreground">
              Authenticate with your Google account to access Gmail and Calendar
              directly from SI Hive. Your credentials are stored securely and never
              shared.
            </p>
          </div>
          <Button onClick={handleAuthenticate} disabled={loading}>
            {loading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <ExternalLink className="h-4 w-4 mr-2" />
            )}
            Authenticate Gmail
          </Button>
          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
