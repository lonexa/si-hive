import { spawnClaudeBatch, parseJsonFromOutput } from '../claude/batch.js';
import { getValidAccessToken } from '../gmail/google-auth.js';
import { listMessages } from '../gmail/gmail-client.js';
import { getTodayEvents } from '../gmail/calendar-client.js';
import type { LiteConfig } from '../types.js';

export interface TodoItem {
  title: string;
  description: string | null;
  priority: 'high' | 'medium' | 'low';
  source: 'ai' | 'manual' | 'email' | 'calendar';
  sourceRef: string | null;
}

export async function generateTodos(
  config: LiteConfig,
  saveConfig: (config: LiteConfig) => void,
): Promise<TodoItem[]> {
  let emailSummary = 'No emails available (Gmail not connected).';
  let calendarSummary = 'No calendar available (Gmail not connected).';

  if (config.gmail?.refreshToken) {
    try {
      const token = await getValidAccessToken(config, saveConfig);

      // Fetch recent unread emails
      const messages = await listMessages(token, { maxResults: 15, q: 'is:unread newer_than:1d' });
      if (messages.length > 0) {
        emailSummary = messages.map((m) =>
          `- From: ${m.from}\n  Subject: ${m.subject}\n  Preview: ${m.snippet}`
        ).join('\n');
      } else {
        emailSummary = 'No unread emails from today.';
      }

      // Fetch today's calendar events
      const events = await getTodayEvents(token);
      if (events.length > 0) {
        calendarSummary = events.map((e) => {
          const time = e.isAllDay ? 'All day' : new Date(e.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          return `- ${time}: ${e.summary}${e.location ? ` (${e.location})` : ''}`;
        }).join('\n');
      } else {
        calendarSummary = 'No events today.';
      }
    } catch (err) {
      console.error('[ai-todo] Error fetching Gmail/Calendar data:', err);
    }
  }

  const prompt = `You are a productivity assistant. Analyze the following emails and calendar events for today and extract actionable todo items.

## Today's Unread Emails
${emailSummary}

## Today's Calendar Events
${calendarSummary}

## Instructions
1. Extract action items from emails that require a response or follow-up
2. Add preparation tasks for upcoming meetings/events
3. Categorize each item by urgency (high/medium/low)
4. Identify the source (email or calendar)
5. Return ONLY a JSON array with this exact structure:

[
  {
    "title": "Brief action item title",
    "description": "More details if needed, or null",
    "priority": "high|medium|low",
    "source": "email|calendar",
    "sourceRef": "email subject or event name, or null"
  }
]

If there are no actionable items, return an empty array: []
Return ONLY the JSON array, no other text.`;

  const output = await spawnClaudeBatch(prompt, 'ai-todo');
  const todos = parseJsonFromOutput<TodoItem[]>(output);

  if (!todos || !Array.isArray(todos)) {
    console.error('[ai-todo] Failed to parse todo items from Claude output:', output.slice(0, 1000));
    return [];
  }

  return todos.map((t) => ({
    title: t.title || 'Untitled',
    description: t.description || null,
    priority: ['high', 'medium', 'low'].includes(t.priority) ? t.priority : 'medium',
    source: ['ai', 'email', 'calendar'].includes(t.source) ? t.source : 'ai',
    sourceRef: t.sourceRef || null,
  }));
}
