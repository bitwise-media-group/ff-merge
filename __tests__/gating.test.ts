import { describe, expect, it } from 'vitest'
import {
  blockingChecks,
  type Check,
  type CompareStatus,
  evaluateGate,
  hasWriteAccess,
  isFastForwardable,
  type PullRequest,
} from '../src/gating'

const check = (name: string, completed: boolean, conclusion: string): Check => ({
  name,
  completed,
  conclusion,
})

describe('hasWriteAccess', () => {
  it.each([
    ['admin', true],
    ['maintain', true],
    ['write', true],
    ['triage', false],
    ['read', false],
    ['none', false],
    ['', false],
  ])('%s -> %s', (permission, expected) => {
    expect(hasWriteAccess(permission)).toBe(expected)
  })
})

describe('isFastForwardable', () => {
  it.each<[CompareStatus, boolean]>([
    ['ahead', true],
    ['identical', true],
    ['behind', false],
    ['diverged', false],
  ])('%s -> %s', (status, expected) => {
    expect(isFastForwardable(status)).toBe(expected)
  })
})

describe('blockingChecks', () => {
  it('passes when there are no checks', () => {
    expect(blockingChecks([])).toEqual([])
  })

  it('treats success, neutral, and skipped as passing', () => {
    expect(
      blockingChecks([
        check('build', true, 'success'),
        check('lint', true, 'neutral'),
        check('optional', true, 'skipped'),
      ]),
    ).toEqual([])
  })

  it('blocks failed, errored, and cancelled conclusions', () => {
    expect(
      blockingChecks([
        check('test', true, 'failure'),
        check('legacy', true, 'error'),
        check('deploy', true, 'cancelled'),
      ]),
    ).toHaveLength(3)
  })

  it('blocks a check run that has not completed', () => {
    expect(blockingChecks([check('e2e', false, 'pending')])).toEqual(['e2e (pending)'])
  })

  it('blocks a pending commit status', () => {
    // A commit status is always "completed"; its pending state must still block.
    expect(blockingChecks([check('ci/external', true, 'pending')])).toEqual([
      'ci/external (pending)',
    ])
  })

  it('reports only the blocking entries from a mixed rollup', () => {
    expect(
      blockingChecks([
        check('build', true, 'success'),
        check('e2e', false, 'running'),
        check('test', true, 'failure'),
        check('ci/ok', true, 'success'),
        check('ci/fail', true, 'failure'),
      ]),
    ).toEqual(['e2e (pending)', 'test (failure)', 'ci/fail (failure)'])
  })
})

describe('evaluateGate', () => {
  const approvedOpenPr: PullRequest = {
    state: 'OPEN',
    isDraft: false,
    baseRef: 'main',
    headSha: 'abc123',
    reviewDecision: 'APPROVED',
  }
  const base = {
    pr: approvedOpenPr,
    checks: [] as Check[],
    compareStatus: 'ahead' as CompareStatus,
    requireApproval: true,
  }

  it('allows an open, approved, green, fast-forwardable PR', () => {
    expect(evaluateGate(base)).toEqual({ allowed: true, reasons: [] })
  })

  it('blocks a closed PR', () => {
    const d = evaluateGate({ ...base, pr: { ...approvedOpenPr, state: 'CLOSED' } })
    expect(d.allowed).toBe(false)
    expect(d.reasons).toContain('PR is CLOSED, not OPEN')
  })

  it('blocks a draft PR', () => {
    const d = evaluateGate({ ...base, pr: { ...approvedOpenPr, isDraft: true } })
    expect(d.allowed).toBe(false)
    expect(d.reasons).toContain('PR is a draft')
  })

  it('blocks when the review decision is not APPROVED', () => {
    const d = evaluateGate({
      ...base,
      pr: { ...approvedOpenPr, reviewDecision: 'REVIEW_REQUIRED' },
    })
    expect(d.allowed).toBe(false)
    expect(d.reasons).toContain('review decision is REVIEW_REQUIRED, need APPROVED')
  })

  it('reports "none" when there is no review decision', () => {
    const d = evaluateGate({ ...base, pr: { ...approvedOpenPr, reviewDecision: null } })
    expect(d.reasons).toContain('review decision is none, need APPROVED')
  })

  it('allows an unapproved PR when approval is not required', () => {
    const d = evaluateGate({
      ...base,
      pr: { ...approvedOpenPr, reviewDecision: null },
      requireApproval: false,
    })
    expect(d.allowed).toBe(true)
  })

  it('blocks when a check is failing', () => {
    const d = evaluateGate({ ...base, checks: [check('test', true, 'failure')] })
    expect(d.allowed).toBe(false)
    expect(d.reasons.some((r) => r.startsWith('checks not passing'))).toBe(true)
  })

  it('blocks when the branch is not fast-forwardable', () => {
    const d = evaluateGate({ ...base, compareStatus: 'diverged' })
    expect(d.allowed).toBe(false)
    expect(d.reasons.some((r) => r.includes('not fast-forwardable (diverged)'))).toBe(true)
  })

  it('accumulates every failing reason at once', () => {
    const d = evaluateGate({
      pr: { ...approvedOpenPr, isDraft: true, reviewDecision: null },
      checks: [check('test', true, 'failure')],
      compareStatus: 'diverged',
      requireApproval: true,
    })
    expect(d.allowed).toBe(false)
    expect(d.reasons).toHaveLength(4) // draft + approval + checks + fast-forward
  })
})
