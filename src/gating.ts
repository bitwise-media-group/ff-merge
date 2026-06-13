// Pure decision logic for the fast-forward merge gate. Every input is
// already-fetched data and there is no I/O here, so the whole gate is
// unit-testable as a table — which matters, because this is the code that
// decides whether to move a protected branch.

// One entry of the PR head commit's status rollup, normalised from either a
// Checks-API check run or a legacy commit status to the fields the gate needs.
export interface Check {
  name: string
  // A check run is complete only when its status is 'completed'; commit
  // statuses are always complete.
  completed: boolean
  // Lower-cased conclusion (check run) or state (commit status): success,
  // neutral, skipped, failure, error, cancelled, pending, ...
  conclusion: string
}

export type CompareStatus = 'ahead' | 'behind' | 'identical' | 'diverged'

export type ReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null

export interface PullRequest {
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  isDraft: boolean
  baseRef: string
  headSha: string
  reviewDecision: ReviewDecision
}

// A completed check passes only with one of these conclusions; everything else
// (failure, error, cancelled, timed_out, action_required, stale, ...) blocks.
const PASSING_CONCLUSIONS = new Set(['success', 'neutral', 'skipped'])
const WRITE_PERMISSIONS = new Set(['admin', 'maintain', 'write'])

export function hasWriteAccess(permission: string): boolean {
  return WRITE_PERMISSIONS.has(permission)
}

// status=ahead -> base is an ancestor of head (a fast-forward is possible);
// identical -> head already equals base. behind/diverged need a rebase.
export function isFastForwardable(status: CompareStatus): boolean {
  return status === 'ahead' || status === 'identical'
}

// A check blocks the merge if it has not completed (pending), or completed with
// a conclusion outside the passing set. Returns a label per blocking check.
export function blockingChecks(checks: Check[]): string[] {
  return checks
    .filter((c) => !c.completed || !PASSING_CONCLUSIONS.has(c.conclusion))
    .map((c) => `${c.name} (${c.completed ? c.conclusion : 'pending'})`)
}

export interface GateInput {
  pr: PullRequest
  checks: Check[]
  compareStatus: CompareStatus
  requireApproval: boolean
}

export interface GateDecision {
  allowed: boolean
  reasons: string[]
}

// Evaluates every gate and accumulates all failing reasons (rather than
// short-circuiting) so a maintainer sees everything wrong in one pass.
export function evaluateGate({
  pr,
  checks,
  compareStatus,
  requireApproval,
}: GateInput): GateDecision {
  const reasons: string[] = []
  if (pr.state !== 'OPEN') reasons.push(`PR is ${pr.state}, not OPEN`)
  if (pr.isDraft) reasons.push('PR is a draft')
  if (requireApproval && pr.reviewDecision !== 'APPROVED') {
    reasons.push(`review decision is ${pr.reviewDecision ?? 'none'}, need APPROVED`)
  }
  const blocking = blockingChecks(checks)
  if (blocking.length > 0) reasons.push(`checks not passing: ${blocking.join(', ')}`)
  if (!isFastForwardable(compareStatus)) {
    reasons.push(`not fast-forwardable (${compareStatus}) — rebase and re-sign onto ${pr.baseRef}`)
  }
  return { allowed: reasons.length === 0, reasons }
}
