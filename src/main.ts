import * as core from '@actions/core'
import { evaluateGate, hasWriteAccess } from './gating'
import {
  comment,
  createOctokit,
  fastForward,
  getChecks,
  getCompareStatus,
  getPermission,
  getPullRequest,
  type Octokit,
  type Repo,
} from './github'
import { getInputs } from './inputs'

export async function run(): Promise<void> {
  const inputs = getInputs()
  const octokit = createOctokit(inputs.token)
  const repo: Repo = { owner: inputs.owner, repo: inputs.repo }

  // 1. The actor must have write+ access. The collaborator-permission endpoint
  // needs the App's administration:read scope.
  if (inputs.maintainerOnly) {
    const permission = await getPermission(octokit, repo, inputs.actor)
    if (!hasWriteAccess(permission)) {
      core.setFailed(`${inputs.actor} lacks write access (got: ${permission || 'none'})`)
      return
    }
    core.info(`actor ${inputs.actor} has '${permission}' access`)
  }

  // 2. Read PR state, the head commit's check rollup, and the fast-forward status.
  const pr = await getPullRequest(octokit, repo, inputs.prNumber)
  const [checks, compareStatus] = await Promise.all([
    getChecks(octokit, repo, pr.headSha),
    getCompareStatus(octokit, repo, pr.baseRef, pr.headSha),
  ])

  // 3. Gate. On refusal, tell the maintainer why on the PR itself, then fail.
  const decision = evaluateGate({
    pr,
    checks,
    compareStatus,
    requireApproval: inputs.requireApproval,
  })
  if (!decision.allowed) {
    await tryComment(
      octokit,
      repo,
      inputs.prNumber,
      `Cannot \`/merge\` this PR yet:\n\n${decision.reasons.map((r) => `- ${r}`).join('\n')}`,
    )
    core.setFailed(decision.reasons.join('; '))
    return
  }

  // 4. Move the ref: this is the merge.
  await fastForward(octokit, repo, pr.baseRef, pr.headSha)
  core.info(`✓ fast-forwarded '${pr.baseRef}' to ${pr.headSha} — signature preserved`)
  core.setOutput('merged', 'true')
  core.setOutput('head-sha', pr.headSha)
  core.setOutput('base', pr.baseRef)

  // 5. Confirmation comment (best effort — the merge already happened).
  await tryComment(
    octokit,
    repo,
    inputs.prNumber,
    `Fast-forwarded \`${pr.baseRef}\` to \`${pr.headSha.slice(0, 12)}\` — original signature preserved, no re-sign.`,
  )
}

async function tryComment(
  octokit: Octokit,
  repo: Repo,
  prNumber: number,
  body: string,
): Promise<void> {
  try {
    await comment(octokit, repo, prNumber, body)
  } catch (err) {
    core.warning(
      `failed to post comment on #${prNumber}: ${err instanceof Error ? err.message : err}`,
    )
  }
}

run().catch((err: unknown) => {
  core.setFailed(err instanceof Error ? err : String(err))
})
