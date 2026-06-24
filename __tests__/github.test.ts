import { describe, expect, it, vi } from 'vitest'
import { getClosingIssues, type Octokit } from '../src/github'

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
