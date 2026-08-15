import { describe, expect, it, vi } from 'vitest'
import {
  COMMENT_MARKER,
  getClosingIssues,
  getPullRequest,
  type Octokit,
  squashMerge,
  upsertComment,
} from '../src/github'

describe('getPullRequest', () => {
  const node = {
    state: 'OPEN',
    isDraft: false,
    baseRefName: 'main',
    headRefOid: 'abc123',
    author: { login: 'bitwise-renovate' },
    mergeable: 'MERGEABLE',
    reviewDecision: 'APPROVED',
    labels: { nodes: [{ name: 'auto-merge' }] },
  }

  it('maps the GraphQL node, including author login and mergeability', async () => {
    const graphql = vi.fn().mockResolvedValue({ repository: { pullRequest: node } })
    const octokit = { graphql } as unknown as Octokit

    expect(await getPullRequest(octokit, { owner: 'acme', repo: 'app' }, 42)).toEqual({
      state: 'OPEN',
      isDraft: false,
      baseRef: 'main',
      headSha: 'abc123',
      authorLogin: 'bitwise-renovate',
      mergeable: 'MERGEABLE',
      reviewDecision: 'APPROVED',
      labels: ['auto-merge'],
    })
  })

  it('maps a ghost (deleted) author to an empty login', async () => {
    const graphql = vi
      .fn()
      .mockResolvedValue({ repository: { pullRequest: { ...node, author: null } } })
    const octokit = { graphql } as unknown as Octokit

    const pr = await getPullRequest(octokit, { owner: 'acme', repo: 'app' }, 42)
    expect(pr.authorLogin).toBe('')
  })
})

describe('squashMerge', () => {
  it('merges via the API squash endpoint with the head-sha guard', async () => {
    const merge = vi.fn().mockResolvedValue({ data: { sha: 'squash456', merged: true } })
    const octokit = { rest: { pulls: { merge } } } as unknown as Octokit

    const sha = await squashMerge(octokit, { owner: 'acme', repo: 'app' }, 42, 'abc123')

    expect(sha).toBe('squash456')
    expect(merge).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'app',
      pull_number: 42,
      merge_method: 'squash',
      sha: 'abc123',
    })
  })
})

describe('getClosingIssues', () => {
  it('maps closingIssuesReferences nodes to owner/repo/number/state', async () => {
    const graphql = vi.fn().mockResolvedValue({
      repository: {
        pullRequest: {
          closingIssuesReferences: {
            nodes: [
              { number: 10, state: 'OPEN', repository: { owner: { login: 'acme' }, name: 'app' } },
              { number: 7, state: 'CLOSED', repository: { owner: { login: 'acme' }, name: 'lib' } },
            ],
          },
        },
      },
    })
    const octokit = { graphql } as unknown as Octokit

    const issues = await getClosingIssues(octokit, { owner: 'acme', repo: 'app' }, 11)

    expect(issues).toEqual([
      { owner: 'acme', repo: 'app', number: 10, state: 'OPEN' },
      { owner: 'acme', repo: 'lib', number: 7, state: 'CLOSED' },
    ])
    expect(graphql).toHaveBeenCalledOnce()
  })

  it.each([
    ['the PR is absent', { repository: { pullRequest: null } }],
    ['the repository is absent', { repository: null }],
    ['references are null', { repository: { pullRequest: { closingIssuesReferences: null } } }],
  ])('returns [] when %s', async (_label, response) => {
    const graphql = vi.fn().mockResolvedValue(response)
    const octokit = { graphql } as unknown as Octokit

    expect(await getClosingIssues(octokit, { owner: 'a', repo: 'b' }, 1)).toEqual([])
  })
})

describe('upsertComment', () => {
  const repo = { owner: 'acme', repo: 'app' }

  function makeOctokit(existing: Array<{ id: number; body?: string }>) {
    const listComments = vi.fn()
    const createComment = vi.fn().mockResolvedValue({})
    const updateComment = vi.fn().mockResolvedValue({})
    const paginate = vi.fn().mockResolvedValue(existing)
    const octokit = {
      paginate,
      rest: { issues: { listComments, createComment, updateComment } },
    } as unknown as Octokit
    return { octokit, paginate, listComments, createComment, updateComment }
  }

  it('creates a new comment, stamped with the marker, when none exists', async () => {
    const { octokit, paginate, listComments, createComment, updateComment } = makeOctokit([
      { id: 1, body: 'a contributor comment' },
      { id: 2, body: undefined },
    ])

    await upsertComment(octokit, repo, 42, 'Cannot `/merge` yet')

    expect(updateComment).not.toHaveBeenCalled()
    expect(createComment).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'app',
      issue_number: 42,
      body: `Cannot \`/merge\` yet\n\n${COMMENT_MARKER}`,
    })
    // Paginates listComments to find the action's prior comment.
    expect(paginate).toHaveBeenCalledWith(listComments, {
      owner: 'acme',
      repo: 'app',
      issue_number: 42,
      per_page: 100,
    })
  })

  it('updates the existing marked comment in place instead of creating another', async () => {
    const { octokit, createComment, updateComment } = makeOctokit([
      { id: 1, body: 'a contributor comment' },
      { id: 7, body: `Cannot \`/merge\` yet\n\n${COMMENT_MARKER}` },
    ])

    await upsertComment(octokit, repo, 42, 'Fast-forwarded `main`')

    expect(createComment).not.toHaveBeenCalled()
    expect(updateComment).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'app',
      comment_id: 7,
      body: `Fast-forwarded \`main\`\n\n${COMMENT_MARKER}`,
    })
  })
})
