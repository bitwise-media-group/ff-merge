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

// GraphQL's Mergeable enum: whether GitHub can compute a clean merge at all.
// Only CONFLICTING is a definite block; UNKNOWN means the computation is still
// running, and the merge API's own sha guard is the authority in that case.
export type Mergeable = 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'

// How the merge lands: 'ff' moves the base ref to the PR head (signatures
// preserved, requires a fast-forwardable branch); 'squash' asks GitHub to
// create a server-side squash commit (web-flow signed, no rebase needed).
export type MergeMethod = 'ff' | 'squash'

export interface PullRequest {
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  isDraft: boolean
  baseRef: string
  headSha: string
  authorLogin: string
  mergeable: Mergeable
  reviewDecision: ReviewDecision
  labels: string[]
}

// A completed check passes only with one of these conclusions; everything else
// (failure, error, cancelled, timed_out, action_required, stale, ...) blocks.
const PASSING_CONCLUSIONS = new Set(['success', 'neutral', 'skipped'])
const WRITE_PERMISSIONS = new Set(['admin', 'maintain', 'write'])

export function hasWriteAccess(permission: string): boolean {
  return WRITE_PERMISSIONS.has(permission)
}

// A PR is "armed" when no label is required, or it carries the required label.
// An unarmed PR is not a candidate for this invocation — the caller skips it
// without merging and without failing (it is an opt-in marker, not a gate
// failure), so this is checked separately from evaluateGate.
export function isArmed(labels: string[], requireLabel: string): boolean {
  return requireLabel === '' || labels.includes(requireLabel)
}

// status=ahead -> base is an ancestor of head (a fast-forward is possible);
// identical -> head already equals base. behind/diverged need a rebase.
export function isFastForwardable(status: CompareStatus): boolean {
  return status === 'ahead' || status === 'identical'
}

// GraphQL reports a GitHub App author's login bare ("bitwise-renovate"), REST
// appends "[bot]", and gh CLI prefixes "app/" — normalise all three spellings
// so the configured squash-authors list matches however it was written.
function normalizeLogin(login: string): string {
  return login
    .toLowerCase()
    .replace(/^app\//, '')
    .replace(/\[bot\]$/, '')
}

// A PR authored by one of the configured squash authors (bot accounts whose
// branches are never rebased onto base, e.g. Renovate) is squash-merged;
// everything else keeps the signature-preserving fast-forward.
export function mergeMethodFor(authorLogin: string, squashAuthors: string[]): MergeMethod {
  const author = normalizeLogin(authorLogin)
  return squashAuthors.some((login) => normalizeLogin(login) === author) ? 'squash' : 'ff'
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
  // null when the merge method is 'squash' — the caller skips the compare
  // read because a squash does not need a fast-forwardable branch.
  compareStatus: CompareStatus | null
  requireApproval: boolean
  mergeMethod: MergeMethod
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
  mergeMethod,
}: GateInput): GateDecision {
  const reasons: string[] = []
  if (pr.state !== 'OPEN') reasons.push(`PR is ${pr.state}, not OPEN`)
  if (pr.isDraft) reasons.push('PR is a draft')
  if (requireApproval && pr.reviewDecision !== 'APPROVED') {
    reasons.push(`review decision is ${pr.reviewDecision ?? 'none'}, need APPROVED`)
  }
  const blocking = blockingChecks(checks)
  if (blocking.length > 0) reasons.push(`checks not passing: ${blocking.join(', ')}`)
  if (mergeMethod === 'ff') {
    if (compareStatus === null || !isFastForwardable(compareStatus)) {
      reasons.push(
        `not fast-forwardable (${compareStatus ?? 'unknown'}) — rebase and re-sign onto ${pr.baseRef}`,
      )
    }
  } else if (pr.mergeable === 'CONFLICTING') {
    // A squash tolerates a behind-base branch, but not conflicts. UNKNOWN (the
    // computation is still running) proceeds: the merge API rejects a merge it
    // cannot perform, and the run retries on the next trigger.
    reasons.push(`has merge conflicts — rebase onto ${pr.baseRef}`)
  }
  return { allowed: reasons.length === 0, reasons }
}
