import * as core from '@actions/core'

export interface Inputs {
  token: string
  owner: string
  repo: string
  prNumber: number
  actor: string
  requireApproval: boolean
  maintainerOnly: boolean
}

export function getInputs(): Inputs {
  const repository = core.getInput('repository', { required: true })
  const [owner, repo] = repository.split('/')
  if (!owner || !repo) {
    throw new Error(`repository must be "owner/repo", got "${repository}"`)
  }

  const prNumber = Number.parseInt(core.getInput('pr-number', { required: true }), 10)
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    throw new Error(`pr-number must be a positive integer, got "${core.getInput('pr-number')}"`)
  }

  return {
    token: core.getInput('token', { required: true }),
    owner,
    repo,
    prNumber,
    actor: core.getInput('actor', { required: true }),
    requireApproval: core.getBooleanInput('require-approval'),
    maintainerOnly: core.getBooleanInput('maintainer-only'),
  }
}
