const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export interface GmailMessage {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  snippet: string;
  date: string;
  labelIds: string[];
  isUnread: boolean;
}

export interface GmailMessageDetail extends GmailMessage {
  body: string;
  to: string;
  cc: string;
}

export interface GmailLabel {
  id: string;
  name: string;
  type: string;
}

async function gmailFetch(accessToken: string, path: string, params?: Record<string, string>): Promise<unknown> {
  const url = new URL(`${GMAIL_API}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail API error: ${res.status} ${text}`);
  }

  return res.json();
}

function decodeHeader(headers: Array<{ name: string; value: string }>, name: string): string {
  const h = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? '';
}

function decodeBody(payload: { body?: { data?: string }; parts?: Array<{ mimeType: string; body?: { data?: string }; parts?: unknown[] }> }): string {
  // Try plain text first, then html
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
  }

  if (payload.parts) {
    // Find text/plain part
    const textPart = payload.parts.find((p) => p.mimeType === 'text/plain');
    if (textPart?.body?.data) {
      return Buffer.from(textPart.body.data, 'base64url').toString('utf-8');
    }
    // Fallback to text/html
    const htmlPart = payload.parts.find((p) => p.mimeType === 'text/html');
    if (htmlPart?.body?.data) {
      const html = Buffer.from(htmlPart.body.data, 'base64url').toString('utf-8');
      // Strip HTML tags for a rough text conversion
      return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
  }

  return '';
}

export async function listMessages(
  accessToken: string,
  options?: { maxResults?: number; q?: string; labelIds?: string },
): Promise<GmailMessage[]> {
  const params: Record<string, string> = {
    maxResults: String(options?.maxResults ?? 20),
  };
  if (options?.q) params.q = options.q;
  if (options?.labelIds) params.labelIds = options.labelIds;

  const data = await gmailFetch(accessToken, '/messages', params) as {
    messages?: Array<{ id: string; threadId: string }>;
  };

  if (!data.messages?.length) return [];

  // Fetch details for each message (batch would be more efficient but this works)
  const messages: GmailMessage[] = [];
  const batch = data.messages.slice(0, options?.maxResults ?? 20);

  for (const msg of batch) {
    try {
      const detailUrl = new URL(`${GMAIL_API}/messages/${msg.id}`);
      detailUrl.searchParams.set('format', 'metadata');
      detailUrl.searchParams.append('metadataHeaders', 'Subject');
      detailUrl.searchParams.append('metadataHeaders', 'From');
      detailUrl.searchParams.append('metadataHeaders', 'Date');
      const detailRes = await fetch(detailUrl.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!detailRes.ok) continue;
      const detail = await detailRes.json() as {
        id: string;
        threadId: string;
        snippet: string;
        labelIds: string[];
        payload: { headers: Array<{ name: string; value: string }> };
      };

      messages.push({
        id: detail.id,
        threadId: detail.threadId,
        subject: decodeHeader(detail.payload.headers, 'Subject'),
        from: decodeHeader(detail.payload.headers, 'From'),
        snippet: detail.snippet,
        date: decodeHeader(detail.payload.headers, 'Date'),
        labelIds: detail.labelIds,
        isUnread: detail.labelIds.includes('UNREAD'),
      });
    } catch {
      // Skip messages that fail to load
    }
  }

  return messages;
}

export async function getMessage(accessToken: string, messageId: string): Promise<GmailMessageDetail> {
  const data = await gmailFetch(accessToken, `/messages/${messageId}`, {
    format: 'full',
  }) as {
    id: string;
    threadId: string;
    snippet: string;
    labelIds: string[];
    payload: {
      headers: Array<{ name: string; value: string }>;
      body?: { data?: string };
      parts?: Array<{ mimeType: string; body?: { data?: string } }>;
    };
  };

  return {
    id: data.id,
    threadId: data.threadId,
    subject: decodeHeader(data.payload.headers, 'Subject'),
    from: decodeHeader(data.payload.headers, 'From'),
    to: decodeHeader(data.payload.headers, 'To'),
    cc: decodeHeader(data.payload.headers, 'Cc'),
    snippet: data.snippet,
    date: decodeHeader(data.payload.headers, 'Date'),
    labelIds: data.labelIds,
    isUnread: data.labelIds.includes('UNREAD'),
    body: decodeBody(data.payload),
  };
}

export async function getUnreadCount(accessToken: string): Promise<number> {
  const data = await gmailFetch(accessToken, '/messages', {
    q: 'is:unread',
    maxResults: '1',
    labelIds: 'INBOX',
  }) as { resultSizeEstimate?: number };

  return data.resultSizeEstimate ?? 0;
}

export async function sendEmail(
  accessToken: string,
  to: string,
  subject: string,
  htmlBody: string,
): Promise<{ id: string; threadId: string }> {
  // Build RFC 2822 message with HTML content
  // Encode subject as RFC 2047 base64 to handle non-ASCII chars (em dash, etc.)
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, 'utf-8').toString('base64')}?=`;
  const boundary = `boundary_${Date.now()}`;
  const rawMessage = [
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    `MIME-Version: 1.0`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    htmlBody.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    '',
    htmlBody,
    '',
    `--${boundary}--`,
  ].join('\r\n');

  const encodedMessage = Buffer.from(rawMessage)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const res = await fetch(`${GMAIL_API}/messages/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: encodedMessage }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail send failed: ${res.status} ${text}`);
  }

  return res.json() as Promise<{ id: string; threadId: string }>;
}

export async function getLabels(accessToken: string): Promise<GmailLabel[]> {
  const data = await gmailFetch(accessToken, '/labels') as {
    labels: Array<{ id: string; name: string; type: string }>;
  };

  return data.labels.map((l) => ({
    id: l.id,
    name: l.name,
    type: l.type,
  }));
}
