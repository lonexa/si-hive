import type { WorkflowTemplate } from './types.js';

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'stock-tracker',
    name: 'Stock Price Tracker',
    description: 'Track stock prices daily and chart the trend over time',
    type: 'scrape',
    icon: 'TrendingUp',
    defaultCron: '30 9 * * 1-5',
    promptHint: 'Track the stock price of [TICKER] from Yahoo Finance',
    defaultDefinition: {
      version: 1,
      type: 'scrape',
      steps: [
        { action: 'fetch', url: 'https://query1.finance.yahoo.com/v8/finance/chart/NVDA?interval=1d&range=1d', method: 'GET' },
        { action: 'extract', selector: 'chart.result.0.meta.regularMarketPrice', field: 'price' },
        { action: 'extract', selector: 'chart.result.0.meta.previousClose', field: 'previousClose' },
      ],
      output: {
        format: 'data',
        dataSchema: {
          fields: [
            { name: 'price', type: 'number', label: 'Current Price' },
            { name: 'previousClose', type: 'number', label: 'Previous Close' },
          ],
        },
        chartConfig: { type: 'line', xField: 'date', yFields: ['price'] },
      },
    },
  },
  {
    id: 'website-monitor',
    name: 'Website Change Monitor',
    description: 'Check a website periodically and alert if content changes',
    type: 'monitor',
    icon: 'Eye',
    defaultCron: '0 * * * *',
    promptHint: 'Monitor [URL] for changes',
    defaultDefinition: {
      version: 1,
      type: 'monitor',
      steps: [
        { action: 'fetch', url: 'https://example.com', method: 'GET' },
        { action: 'extract', regex: '<title>(.*?)</title>', field: 'title' },
      ],
      output: { format: 'text' },
    },
  },
  {
    id: 'web-form',
    name: 'Web Form Automation',
    description: 'Automate filling out web forms like expense reports or timesheets',
    type: 'browser',
    icon: 'FileInput',
    defaultCron: '0 8 * * 1-5',
    promptHint: 'Log into [SITE] and fill out [FORM] with [DATA]',
    defaultDefinition: {
      version: 1,
      type: 'browser',
      playwrightScript: `// Navigate to the target site
await page.goto('https://example.com/login');
// Login (credentials replaced at runtime)
await page.fill('#username', '{{USERNAME}}');
await page.fill('#password', '{{PASSWORD}}');
await page.click('#login-button');
await page.waitForNavigation();
_logs.push('Logged in successfully');`,
      output: { format: 'text' },
    },
  },
  {
    id: 'api-health',
    name: 'API Health Check',
    description: 'Monitor API endpoints and track response times',
    type: 'api',
    icon: 'Activity',
    defaultCron: '*/5 * * * *',
    promptHint: 'Check the health of [API_URL]',
    defaultDefinition: {
      version: 1,
      type: 'api',
      steps: [
        { action: 'fetch', url: 'https://api.example.com/health', method: 'GET' },
        { action: 'extract', selector: 'status', field: 'status' },
      ],
      output: {
        format: 'data',
        dataSchema: {
          fields: [
            { name: 'status', type: 'string', label: 'Status' },
          ],
        },
      },
    },
  },
  {
    id: 'news-aggregator',
    name: 'News/RSS Aggregator',
    description: 'Collect headlines from news sites or RSS feeds daily',
    type: 'scrape',
    icon: 'Newspaper',
    defaultCron: '0 7 * * *',
    promptHint: 'Scrape the latest headlines from [NEWS_SITE]',
    defaultDefinition: {
      version: 1,
      type: 'scrape',
      steps: [
        { action: 'fetch', url: 'https://news.ycombinator.com/rss', method: 'GET' },
        { action: 'extract', regex: '<title>(.*?)</title>', field: 'headlines' },
      ],
      output: { format: 'text' },
    },
  },
];
