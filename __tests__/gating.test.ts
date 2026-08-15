import { describe, expect, it } from 'vitest'
import {
  blockingChecks,
  type Check,
  type CompareStatus,
  evaluateGate,
  hasWriteAccess,
  isArmed,
  isFastForwardable,
  mergeMethodFor,
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

describe('isArmed', () => {
  it.each<[string[], string, boolean]>([
    [[], '', true], // no label required -> always armed
    [['auto-merge'], '', true], // no label required, labels present -> armed
    [['auto-merge'], 'auto-merge', true], // required label present -> armed
    [['other', 'auto-merge'], 'auto-merge', true], // present among others -> armed
    [[], 'auto-merge', false], // required label absent (no labels) -> not armed
    [['other'], 'auto-merge', false], // required label absent -> not armed
    [['Auto-Merge'], 'auto-merge', false], // exact-match only (case-sensitive)
  ])('labels=%j require=%j -> %s', (labels, requireLabel, expected) => {
    expect(isArmed(labels, requireLabel)).toBe(expected)
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

describe('mergeMethodFor', () => {
  it.each<[string, string[], 'ff' | 'squash']>([
    // empty list -> everything fast-forwards
    ['bitwise-renovate', [], 'ff'],
    // exact match
    ['bitwise-renovate', ['bitwise-renovate'], 'squash'],
    // GraphQL reports the bare app login; the config may use the REST or gh
    // CLI spellings — all three must match
    ['bitwise-renovate', ['bitwise-renovate[bot]'], 'squash'],
    ['bitwise-renovate[bot]', ['bitwise-renovate'], 'squash'],
    ['bitwise-renovate', ['app/bitwise-renovate'], 'squash'],
    // case-insensitive
    ['Bitwise-Renovate', ['bitwise-renovate'], 'squash'],
    // non-matching author, and one of several entries matching
    ['dmccaffery', ['bitwise-renovate[bot]'], 'ff'],
    ['dependabot', ['bitwise-renovate[bot]', 'dependabot[bot]'], 'squash'],
    // a ghost (deleted) author is mapped to '' and never squashes
    ['', ['bitwise-renovate[bot]'], 'ff'],
  ])('author=%j squashAuthors=%j -> %s', (author, squashAuthors, expected) => {
    expect(mergeMethodFor(author, squashAuthors)).toBe(expected)
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
    authorLogin: 'dmccaffery',
    mergeable: 'MERGEABLE',
    reviewDecision: 'APPROVED',
    labels: [],
  }
  const base = {
    pr: approvedOpenPr,
    checks: [] as Check[],
    compareStatus: 'ahead' as CompareStatus,
    requireApproval: true,
    mergeMethod: 'ff' as const,
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

  it('blocks a missing compare status on the fast-forward path', () => {
    const d = evaluateGate({ ...base, compareStatus: null })
    expect(d.allowed).toBe(false)
    expect(d.reasons.some((r) => r.includes('not fast-forwardable (unknown)'))).toBe(true)
  })

  it('accumulates every failing reason at once', () => {
    const d = evaluateGate({
      pr: { ...approvedOpenPr, isDraft: true, reviewDecision: null },
      checks: [check('test', true, 'failure')],
      compareStatus: 'diverged',
      requireApproval: true,
      mergeMethod: 'ff',
    })
    expect(d.allowed).toBe(false)
    expect(d.reasons).toHaveLength(4) // draft + approval + checks + fast-forward
  })

  describe('squash path', () => {
    // A Renovate-style branch: behind base (merges without a rebase have
    // happened since it was cut), but cleanly mergeable.
    const squash = { ...base, compareStatus: null, mergeMethod: 'squash' as const }

    it('allows a behind-base branch — no fast-forward requirement', () => {
      expect(evaluateGate(squash)).toEqual({ allowed: true, reasons: [] })
    })

    it('blocks a conflicting branch', () => {
      const d = evaluateGate({ ...squash, pr: { ...approvedOpenPr, mergeable: 'CONFLICTING' } })
      expect(d.allowed).toBe(false)
      expect(d.reasons).toEqual(['has merge conflicts — rebase onto main'])
    })

    it('proceeds while mergeability is still being computed', () => {
      // UNKNOWN is not a block: the merge API itself is the authority, and a
      // rejected call simply retries on the next trigger.
      const d = evaluateGate({ ...squash, pr: { ...approvedOpenPr, mergeable: 'UNKNOWN' } })
      expect(d.allowed).toBe(true)
    })

    it('still requires approval and green checks', () => {
      const d = evaluateGate({
        ...squash,
        pr: { ...approvedOpenPr, reviewDecision: 'REVIEW_REQUIRED' },
        checks: [check('test', true, 'failure')],
      })
      expect(d.allowed).toBe(false)
      expect(d.reasons).toHaveLength(2) // approval + checks
    })
  })
})
