/**
 * Recorded-HTTP fixture format for the integration contract tests.
 *
 * Each provider ships `__tests__/fixtures/<providerId>.ts` exporting a
 * `ProviderFixture`. The contract suite replaces `fetch` with a router over
 * `routes` and runs the same scenario against every provider, so a new
 * provider only needs realistic canned responses to be verified.
 */
export interface FixtureRoute {
  method?: string;
  /** Matched against the full request URL (including query). First match wins. */
  url: RegExp;
  status?: number;
  /** Object → JSON body; string → text body; Buffer → bytes. */
  body?: unknown;
  headers?: Record<string, string>;
}

export interface ProviderFixture {
  providerId: string;
  settings: Record<string, string | boolean>;
  secrets: Record<string, string>;
  routes: FixtureRoute[];
  /** Identifiers that exist in the fixture data. */
  sample: {
    /** Git host: a repo fullName with PRs/commits/builds in the fixtures. */
    repo?: string;
    prNumber?: number;
    buildId?: string;
    /** Tracker: an issue key that getIssue can load. */
    issueKey?: string;
    /** Free text containing a ticket reference the tracker should detect. */
    textWithRef?: string;
  };
}
