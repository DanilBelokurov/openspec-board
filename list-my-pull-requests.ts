import { z } from 'zod';
import type { BitbucketPage, BitbucketPullRequest } from '../client/bitbucket-types.js';
import { READ_ONLY } from './annotations.js';
import { defineTool } from './define-tool.js';
import { formatPaginatedResponse, toMinimalPullRequest } from './formatting.js';
import { paginationSchema } from './schemas.js';

/** MCP-инструмент bitbucket_list_my_pull_requests. */
export default defineTool({
  name: 'bitbucket_list_my_pull_requests',
  group: 'read',
  description:
    'List pull requests for the authenticated user across all repositories — as author, reviewer, or participant. Filters by role and review status. Returns 25 results per page by default.',
  inputSchema: {
    role: z
      .enum(['AUTHOR', 'REVIEWER', 'PARTICIPANT'])
      .optional()
      .describe(
        'Filter by your role. AUTHOR (created by you), REVIEWER (you are a reviewer), PARTICIPANT (any involvement).',
      ),
    reviewerStatus: z
      .enum(['APPROVED', 'UNAPPROVED', 'NEEDS_WORK'])
      .optional()
      .describe(
        'Filter by your review status. APPROVED (approved the PR), NEEDS_WORK (requested changes), UNAPPROVED (not yet reviewed or reset). Most useful with role: REVIEWER.',
      ),
    state: z.enum(['OPEN', 'DECLINED', 'MERGED']).optional().describe('Filter by PR state. Default: OPEN.'),
    order: z.enum(['NEWEST', 'OLDEST']).optional().describe('Sort order by date. Default: NEWEST.'),
    ...paginationSchema,
  },
  annotations: READ_ONLY,
  handler: async ({ role, reviewerStatus, state, order, start, limit }, client) => {
    const endpoint = '/rest/api/1.0/dashboard/pull-requests';

    const params: Record<string, string | undefined> = {
      role,
      participantStatus: reviewerStatus,
      state,
      order,
      start: start?.toString(),
      limit: limit?.toString(),
    };

    const result = await client.getJson<BitbucketPage<BitbucketPullRequest>>(endpoint, params);

    return {
      content: [{ type: 'text', text: JSON.stringify(formatPaginatedResponse(result, toMinimalPullRequest)) }],
    };
  },
});
