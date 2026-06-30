import { describe, expect, it, vi } from 'vitest'
import { COMMENT_MARKER, getClosingIssues, type Octokit, upsertComment } from '../src/github'

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
