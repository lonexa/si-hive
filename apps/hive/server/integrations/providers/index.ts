/**
 * Registered integration providers. To add one, create
 * `./<id>/index.ts` exporting an IntegrationProviderDefinition (start from
 * `../_template/index.ts`) and append it here.
 */
import type { IntegrationProviderDefinition } from '../types.js';
import { githubProvider } from './github/index.js';
import { gitlabProvider } from './gitlab/index.js';
import { azureDevOpsProvider } from './azure-devops/index.js';
import { jiraProvider } from './jira/index.js';
import { linearProvider } from './linear/index.js';

export const INTEGRATION_PROVIDERS: IntegrationProviderDefinition[] = [
  githubProvider,
  gitlabProvider,
  azureDevOpsProvider,
  jiraProvider,
  linearProvider,
];
