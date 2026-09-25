import type { NotifyDirective } from '../types.js';

export interface RunDataPoint {
  timestamp: string;
  [key: string]: unknown;
}

/** Replace {{workflowName}}, {{date}}, {{runCount}} in a template string */
export function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

const TH = 'padding:6px 12px;border:1px solid #ddd;background:#f5f5f5;text-align:left;';
const TD = 'padding:6px 12px;border:1px solid #ddd;';
const LINK = 'color:#1a73e8;text-decoration:none;';

/** Friendly label for regex capture group keys like g1, g2 */
function friendlyLabel(key: string, allKeys: string[]): string {
  // If keys are g1, g2 etc., try to infer meaning
  if (/^g\d+$/.test(key)) {
    // Common pattern: g1=url, g2=title for scraped content
    const idx = parseInt(key.slice(1));
    if (allKeys.length === 2) {
      return idx === 1 ? 'Link' : 'Title';
    }
    return `Field ${idx}`;
  }
  // Capitalize first letter
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** Check if a string looks like a URL */
function isUrl(s: string): boolean {
  return /^https?:\/\//.test(s) || s.startsWith('item?id=');
}

/** Render a single value as HTML */
function renderValueHtml(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'number') return val.toLocaleString();
  if (typeof val === 'string') {
    if (isUrl(val)) return `<a href="${val}" style="${LINK}">${val.length > 60 ? val.slice(0, 60) + '...' : val}</a>`;
    return val;
  }
  if (typeof val === 'object' && !Array.isArray(val)) {
    return Object.entries(val as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${renderValueHtml(v)}`)
      .join(', ');
  }
  return String(val);
}

/** Render an array of objects as an HTML sub-table */
function renderArrayTable(items: Record<string, unknown>[]): string {
  if (items.length === 0) return '<em>(none)</em>';

  const keys = Object.keys(items[0]);

  // Reorder: put non-URL fields first (titles before links)
  const urlKeys = keys.filter(k => items.some(item => isUrl(String(item[k] ?? ''))));
  const nonUrlKeys = keys.filter(k => !urlKeys.includes(k));
  const orderedKeys = [...nonUrlKeys, ...urlKeys];
  const orderedLabels = orderedKeys.map(k => friendlyLabel(k, keys));

  const headerRow = orderedLabels.map(l => `<th style="${TH}">${l}</th>`).join('');
  const bodyRows = items.map(item => {
    const cells = orderedKeys.map(k => `<td style="${TD}">${renderValueHtml(item[k])}</td>`);
    return `<tr>${cells.join('')}</tr>`;
  }).join('');

  return `<table style="border-collapse:collapse;font-family:system-ui,sans-serif;font-size:13px;width:100%;margin:4px 0;">
    <thead><tr>${headerRow}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>`;
}

/** Format run data as an HTML email */
export function formatHtmlTable(
  workflowName: string,
  data: RunDataPoint[],
  directive: NotifyDirective,
): string {
  if (data.length === 0) {
    return `<p>No data available for <strong>${workflowName}</strong>.</p>`;
  }

  const preamble = directive.message ? `<p>${directive.message}</p>` : '';
  const sections: string[] = [];

  for (const row of data) {
    const date = new Date(row.timestamp).toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    });

    const fields = Object.keys(row).filter(k => k !== 'timestamp');
    const parts: string[] = [];

    for (const field of fields) {
      const val = row[field];

      if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'object' && val[0] !== null) {
        // Array of objects: render as sub-table
        parts.push(`<div style="margin:8px 0;">
          <strong style="font-size:13px;color:#555;">${field} (${val.length})</strong>
          ${renderArrayTable(val as Record<string, unknown>[])}
        </div>`);
      } else if (Array.isArray(val)) {
        // Array of primitives: render as bulleted list
        parts.push(`<div style="margin:8px 0;">
          <strong style="font-size:13px;color:#555;">${field} (${val.length})</strong>
          <ul style="margin:4px 0;padding-left:20px;">${val.map(v => `<li style="font-size:13px;">${renderValueHtml(v)}</li>`).join('')}</ul>
        </div>`);
      } else {
        // Simple value: key = value line
        parts.push(`<div style="margin:4px 0;font-size:13px;">
          <strong style="color:#555;">${field}:</strong> ${renderValueHtml(val)}
        </div>`);
      }
    }

    sections.push(`<div style="margin-bottom:16px;padding:12px;border:1px solid #e0e0e0;border-radius:6px;">
      <div style="font-size:12px;color:#888;margin-bottom:8px;">${date}</div>
      ${parts.join('')}
    </div>`);
  }

  return `
    ${preamble}
    <h3 style="margin:0 0 12px 0;font-family:system-ui,sans-serif;">${workflowName}</h3>
    ${sections.join('')}
    <p style="color:#888;font-size:11px;margin-top:16px;font-family:system-ui,sans-serif;">Sent by SI Hive Workflow Studio</p>
  `.trim();
}

/** Format run data as plain text (for Slack/Google Chat/webhook) */
export function formatPlainText(
  workflowName: string,
  data: RunDataPoint[],
  directive: NotifyDirective,
): string {
  if (data.length === 0) {
    return `No data available for ${workflowName}.`;
  }

  const preamble = directive.message ? `${directive.message}\n\n` : '';
  const sections: string[] = [];

  for (const row of data) {
    const date = new Date(row.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const fields = Object.keys(row).filter(k => k !== 'timestamp');
    const lines: string[] = [`*${date}*`];

    for (const field of fields) {
      const val = row[field];
      if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'object') {
        const items = val as Record<string, unknown>[];
        const keys = Object.keys(items[0]);
        lines.push(`${field} (${items.length}):`);
        for (const item of items) {
          const parts = keys.map(k => String(item[k] ?? '')).filter(Boolean);
          lines.push(`  - ${parts.join(' | ')}`);
        }
      } else if (Array.isArray(val)) {
        lines.push(`${field}: ${val.join(', ')}`);
      } else {
        lines.push(`${field}: ${String(val ?? '')}`);
      }
    }

    sections.push(lines.join('\n'));
  }

  return `${preamble}*${workflowName}*\n\n${sections.join('\n\n')}`;
}

/** Format run data as raw JSON */
export function formatRawData(
  workflowName: string,
  data: RunDataPoint[],
): string {
  return JSON.stringify({ workflow: workflowName, data }, null, 2);
}
