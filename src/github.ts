import * as github from '@actions/github'
import type { Check, CompareStatus, PullRequest, ReviewDecision } from './gating'

export type Octokit = ReturnType<typeof github.getOctokit>

export interface Repo {
  owner: string
  repo: string
}

export function createOctokit(token: string): Octokit {
  return github.getOctokit(token)
}

interface PullRequestQuery {
  repository: {
    pullRequest: {
      state: 'OPEN' | 'CLOSED' | 'MERGED'
      isDraft: boolean
      baseRefName: string
      headRefOid: string
      reviewDecision: ReviewDecision
      labels: { nodes: Array<{ name: string }> } | null
    } | null
  } | null
}

// PR state plus its review decision in one shot. reviewDecision folds in
// branch-protection required reviewers and CODEOWNERS and has no REST
// equivalent, so this is a GraphQL query.
export async function getPullRequest(
  octokit: Octokit,
  { owner, repo }: Repo,
  number: number,
): Promise<PullRequest> {
  const { repository } = await octokit.graphql<PullRequestQuery>(
    `query ($owner: String!, $repo: String!, $number: Int!) {
       repository(owner: $owner, name: $repo) {
         pullRequest(number: $number) {
           state
           isDraft
           baseRefName
           headRefOid
           reviewDecision
           labels(first: 100) { nodes { name } }
         }
       }
     }`,
    { owner, repo, number },
  )

  const pr = repository?.pullRequest
  if (!pr) {
    throw new Error(`pull request #${number} not found in ${owner}/${repo}`)
  }

  return {
    state: pr.state,
    isDraft: pr.isDraft,
    baseRef: pr.baseRefName,
    headSha: pr.headRefOid,
    reviewDecision: pr.reviewDecision,
    labels: (pr.labels?.nodes ?? []).map((node) => node.name),
  }
}

export interface ClosingIssue {
  owner: string
  repo: string
  number: number
  state: 'OPEN' | 'CLOSED'
}

interface ClosingIssuesQuery {
  repository: {
    pullRequest: {
      closingIssuesReferences: {
        nodes: Array<{
          number: number
          state: 'OPEN' | 'CLOSED'
          repository: { owner: { login: string }; name: string }
        }>
      } | null
    } | null
  } | null
}

// The issues a PR's body marks for closure via keywords (Closes/Fixes/Resolves).
// This is GitHub's own parse — every keyword form, same- and cross-repo refs —
// exposed only on GraphQL, with no REST equivalent. It is the exact set GitHub
// would auto-close on a normal merge but skips on a fast-forward. first:50 is a
// sane ceiling; a single PR closing more than that is not a real workflow.
export async function getClosingIssues(
  octokit: Octokit,
  { owner, repo }: Repo,
  number: number,
): Promise<ClosingIssue[]> {
  const { repository } = await octokit.graphql<ClosingIssuesQuery>(
    `query ($owner: String!, $repo: String!, $number: Int!) {
       repository(owner: $owner, name: $repo) {
         pullRequest(number: $number) {
           closingIssuesReferences(first: 50) {
             nodes {
               number
               state
               repository { owner { login } name }
             }
           }
         }
       }
     }`,
    { owner, repo, number },
  )

  const nodes = repository?.pullRequest?.closingIssuesReferences?.nodes ?? []
  return nodes.map((node) => ({
    owner: node.repository.owner.login,
    repo: node.repository.name,
    number: node.number,
    state: node.state,
  }))
}

// The full status rollup for the head commit: Checks-API check runs plus legacy
// commit statuses, both fully paginated so a PR with more than a page of checks
// can't slip a failing one past the gate.
export async function getChecks(
  octokit: Octokit,
  { owner, repo }: Repo,
  ref: string,
): Promise<Check[]> {
  const runs = await octokit.paginate(octokit.rest.checks.listForRef, {
    owner,
    repo,
    ref,
    per_page: 100,
  })
  const statuses = await octokit.paginate(octokit.rest.repos.listCommitStatusesForRef, {
    owner,
    repo,
    ref,
    per_page: 100,
  })

  // listCommitStatusesForRef returns every status event newest-first; collapse
  // to the latest state per context.
  const latestStatus = new Map<string, (typeof statuses)[number]>()
  for (const status of statuses) {
    if (!latestStatus.has(status.context)) latestStatus.set(status.context, status)
  }

  return [
    ...runs.map((run) => ({
      name: run.name,
      completed: run.status === 'completed',
      conclusion: (run.conclusion ?? 'pending').toLowerCase(),
    })),
    ...[...latestStatus.values()].map((status) => ({
      name: status.context,
      completed: true,
      conclusion: status.state.toLowerCase(),
    })),
  ]
}

export async function getCompareStatus(
  octokit: Octokit,
  { owner, repo }: Repo,
  base: string,
  head: string,
): Promise<CompareStatus> {
  const { data } = await octokit.rest.repos.compareCommitsWithBasehead({
    owner,
    repo,
    basehead: `${base}...${head}`,
  })
  return data.status as CompareStatus
}

export async function getPermission(
  octokit: Octokit,
  { owner, repo }: Repo,
  username: string,
): Promise<string> {
  const { data } = await octokit.rest.repos.getCollaboratorPermissionLevel({
    owner,
    repo,
    username,
  })
  return data.permission
}

// Move the base ref to the PR head. force:false means GitHub independently
// rejects any non-fast-forward update — a second backstop behind the explicit
// compare check. Because the commit object is untouched, its signature is
// preserved and GitHub marks the PR merged.
export async function fastForward(
  octokit: Octokit,
  { owner, repo }: Repo,
  base: string,
  sha: string,
): Promise<void> {
  await octokit.rest.git.updateRef({ owner, repo, ref: `heads/${base}`, sha, force: false })
}

export async function comment(
  octokit: Octokit,
  { owner, repo }: Repo,
  issueNumber: number,
  body: string,
): Promise<void> {
  await octokit.rest.issues.createComment({ owner, repo, issue_number: issueNumber, body })
}

// Close an issue with an explanatory comment — replays the keyword auto-close
// GitHub skips on a fast-forward merge. Needs the App's issues:write scope; the
// caller treats a failure here as best-effort since the merge already landed.
export async function closeIssue(
  octokit: Octokit,
  { owner, repo }: Repo,
  number: number,
  body: string,
): Promise<void> {
  await octokit.rest.issues.createComment({ owner, repo, issue_number: number, body })
  await octokit.rest.issues.update({
    owner,
    repo,
    issue_number: number,
    state: 'closed',
    state_reason: 'completed',
  })
}
