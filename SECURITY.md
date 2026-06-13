# Security Policy

## Reporting a vulnerability

Please report vulnerabilities privately via
[GitHub Security Advisories](https://github.com/bitwise-media-group/ff-merge/security/advisories/new). Do not open
public issues for security reports.

## Threat model (summary)

This action moves a base branch ref to an approved pull request's head commit — a fast-forward that preserves the
original commit signature. It runs with a GitHub App token that is in the branch's ruleset **bypass** list, so the
action is the trust boundary, not branch protection. It defends against:

- **Merging an ineligible PR** — before moving the ref the action independently re-verifies that the triggering actor
  has write access, the PR is open and not a draft, its review decision is `APPROVED`, every status check has passed,
  and the head is a genuine fast-forward of the base. This gating is code with unit coverage, not configuration.
- **Bypass turning into a hole** — the App's ruleset bypass also bypasses required reviews and checks, so the action
  re-checks them itself rather than trusting that branch protection ran. The API's own non-fast-forward rejection is a
  second backstop behind the explicit compare.
- **Privilege creep** — the action takes a short-lived GitHub App installation token (`contents: write`,
  `pull-requests: write`, `administration: read`) minted per run by the calling workflow; it stores no credentials and
  never weakens its own gating via input.

Out of scope: compromise of the GitHub App private key (the trust anchor), and compromise of the runner executing this
action.

## Code scanning triage

CodeQL findings are triaged in [`security/code-scanning/index.md`](security/code-scanning/index.md), with a report per
finding recording why it was dismissed or how it was remediated.
