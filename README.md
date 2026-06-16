# ff-merge

A GitHub Action — and the reusable workflows that drive it — for **signature-preserving fast-forward merges**. A
maintainer comments `/merge` on an approved, green PR and the base branch is fast-forwarded to the PR head, keeping each
commit's original signature.

GitHub's merge button can't give you a linear history that keeps the **original developer's signature**:

| Strategy         | History    | Signature on the base branch                                                     |
| ---------------- | ---------- | -------------------------------------------------------------------------------- |
| Merge commit     | non-linear | underlying commits stay signed; the merge commit is GitHub `web-flow` RSA-signed |
| Squash           | linear     | new object → GitHub RSA-signed, original authorship & signature gone             |
| Rebase           | linear     | new objects (new SHAs) → original signatures stripped                            |
| **Fast-forward** | **linear** | **objects untouched → original developer signatures intact**                     |

A fast-forward isn't a merge — it just moves the base ref to a commit that already exists (the PR head). Because the
commit object is unchanged, its SHA and embedded signature survive exactly. A welcome side effect: with each
Conventional Commit landing individually on the base branch, **release-please no longer needs the squash-footer
workaround** — it attributes every `fix:` / `feat:` natively.

Everything here is first-party: this action, the GitHub-published `@actions/*` packages it bundles, and
[`actions/create-github-app-token`](https://github.com/actions/create-github-app-token). No unknown third-party
marketplace actions.

## What's in this repo

- **`ff-merge` action** (root `action.yml`, TypeScript in `src/`) — verifies eligibility and moves the ref. The gate is
  pure, unit-tested logic; the GitHub I/O is a thin Octokit wrapper.
- **`.github/workflows/ff-merge.yaml`** — reusable workflow: mints the App token and runs the action.
- **`.github/workflows/ff-merge-notice.yaml`** — reusable workflow: comments on newly opened PRs explaining how to
  merge.
- **`examples/`** — the thin caller workflows each consuming repo copies in.

## How it works

1. A maintainer comments `/merge` on an approved PR.
2. The caller workflow (in the consuming repo) fires on `issue_comment` and calls this repo's reusable `ff-merge.yaml`
   with the PR number.
3. The reusable workflow mints a short-lived App token and runs the `ff-merge` action, which verifies, in order: the
   actor has **write+** access · the PR is **open**, not a draft · its review decision is **APPROVED** · **all checks
   pass** · the head is a true **fast-forward** of its base.
4. The action moves the base ref to the PR head. GitHub sees the head become reachable from base and auto-marks the PR
   **Merged**. On refusal it comments the reasons on the PR and fails the check.

`git log --show-signature` on the base branch shows the original developer's signature — verifiable end to end.

## One-time org setup

### 1. Create the GitHub App

Org **Settings → Developer settings → GitHub Apps → New GitHub App**.

- **Name:** `FF Merge` (any name).
- **Webhook:** uncheck **Active** (not needed).
- **Repository permissions:**

  | Permission     | Level            | Why                                           |
  | -------------- | ---------------- | --------------------------------------------- |
  | Contents       | **Read & write** | move the base ref (the merge itself)          |
  | Pull requests  | **Read & write** | read PR state; post the confirmation comment  |
  | Administration | **Read-only**    | resolve the actor's permission level (step 3) |

  > Don't want `Administration: read`? Set `maintainer-only: false` and rely on the caller's `author_association` gate
  > instead. You lose the precise write-vs-triage distinction but drop the broader scope.

- **Where can this app be installed?** Only on this account.

Create it, **Generate a private key** (downloads a `.pem`), and note the **Client ID**.

### 2. Install the App

From the App's page → **Install App** → install on the org, **All repositories** (or the ones that will use `/merge`).
The App must be installed on every repo that calls the workflow.

### 3. Publish the credentials org-wide

Org **Settings → Secrets and variables → Actions**:

- **Variables → New** → `FF_MERGE_CLIENT_ID` = the Client ID.
- **Secrets → New** → `FF_MERGE_PRIVATE_KEY` = the full contents of the `.pem`.

Set both to **All repositories** (or scope to selected repos), so consuming repos need no per-repo secret config.

### 4. Let the App bypass branch protection

The ref update is a direct write to a protected branch, so the App must bypass the pull-request rule. In a per-repo (or
org-level) **ruleset** — **Settings → Rules → Rulesets → New branch ruleset** — set:

- **Target branches:** `main` (and any release branches you fast-forward into).
- **Bypass list:** add the **FF Merge** App.
- **Rules:** ✅ Require linear history · ✅ Require a pull request before merging (with approvals) · ✅ Require status
  checks to pass · ✅ Require branches to be up to date before merging · ✅ Block force pushes.

> **Why the App bypasses, yet nothing is unguarded:** the bypass also bypasses required reviews and checks, so the
> action re-verifies approval and checks itself rather than trusting that branch protection ran. Branch protection is
> the human guard rail; the action is the automation guard rail. Both hold.

## Per-repo setup

Copy [`examples/ff-merge.yaml`](examples/ff-merge.yaml) to `.github/workflows/ff-merge.yaml` in the consuming repo —
that's the entire per-repo footprint. Then a maintainer can comment `/merge` on any approved, green, up-to-date PR.

Optionally also copy [`examples/ff-merge-notice.yaml`](examples/ff-merge-notice.yaml) — see below.

## `ff-merge-notice` — tell contributors how to merge

When a PR is opened this companion workflow posts a single comment explaining that the repo merges by fast-forward via a
`/merge` comment, so contributors who don't know the convention don't reach for the merge button.

It triggers on **`pull_request_target` (opened)** rather than `pull_request`, so the notice also reaches **fork PRs** —
where it matters most, since a fork's `pull_request` token is read-only and couldn't comment. This is the safe use of
that trigger: it never checks out or runs PR code and interpolates no PR-controlled content; it only posts a static
comment with a token scoped to `pull-requests: write`. No App token or secret is involved.

To never grant an elevated token on fork PRs, switch the caller to `pull_request` (opened) and add
`if: '!github.event.pull_request.head.repo.fork'` — same-repo PRs still get the notice; fork PRs get nothing.

## The one real trade-off

A fast-forward is only possible when the branch is a **direct descendant of the base tip**. When the base moves, the
contributor must **rebase and re-sign locally** — never rebase server-side, since that rewrites objects and re-signs
them, defeating the whole point. The _Require branches to be up to date_ rule enforces this. The cost is
**serialization**: under contention, the second PR rebases again before it can merge. For typical throughput this is a
non-issue; for a high-traffic monorepo it's the price of preserved signatures. (GitHub's native merge queue would remove
the contention but re-signs every commit, so it's out.)

## Configuration reference

### `ff-merge` action

| Input              | Default                    | Meaning                                                                      |
| ------------------ | -------------------------- | ---------------------------------------------------------------------------- |
| `token`            | — (required)               | App installation token (`contents`, `pull-requests`, `administration:read`). |
| `repository`       | `${{ github.repository }}` | `owner/repo` whose base branch is fast-forwarded.                            |
| `pr-number`        | — (required)               | PR to fast-forward.                                                          |
| `actor`            | `${{ github.actor }}`      | Login checked for write access when `maintainer-only` is true.               |
| `require-approval` | `true`                     | Require review decision `APPROVED`.                                          |
| `maintainer-only`  | `true`                     | Require the actor to have write+ access.                                     |
| `require-label`    | `''` (none)                | If set, skip (no merge, no failure) unless the PR carries this exact label.  |

Outputs: `merged` (`"true"` on success, `"false"` when skipped for a missing `require-label`), `head-sha`, `base`.

### `ff-merge.yaml` reusable workflow

| Input              | Default      | Meaning                                                    |
| ------------------ | ------------ | ---------------------------------------------------------- |
| `pr-number`        | — (required) | PR to fast-forward.                                        |
| `client-id`        | — (required) | App Client ID, typically `${{ vars.FF_MERGE_CLIENT_ID }}`. |
| `require-approval` | `true`       | Passed through to the action.                              |
| `maintainer-only`  | `true`       | Passed through to the action.                              |

Secret: `app-key` — the App private key, typically `${{ secrets.FF_MERGE_PRIVATE_KEY }}`.

## Development

```sh
npm ci
npm run all     # biome + markdownlint, tsc --noEmit, vitest, rollup build
npm test        # unit tests only
npm run build   # rebuild dist/index.js
```

| Path            | Role                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------ |
| `src/gating.ts` | pure gate logic — the unit-tested decision table                                                       |
| `src/github.ts` | Octokit wrapper: paginated check rollup, GraphQL review decision, ref move                             |
| `src/inputs.ts` | input parsing                                                                                          |
| `src/main.ts`   | orchestration                                                                                          |
| `__tests__/`    | vitest                                                                                                 |
| `dist/index.js` | the Rollup bundle consumers actually run — committed, and CI fails if it doesn't reproduce from `src/` |

There is no e2e: running the action for real would move a branch ref, so the gating logic is covered by the unit table
instead, with the API's own non-fast-forward rejection as a backstop.

### Releasing

release-please runs in manifest mode (`release-please-config.json` + `.release-please-manifest.json`) so the first run
is deterministic: the `0.0.0` manifest anchor plus the initial `feat:` commit cut `v0.1.0` rather than a bootstrapped
guess. It watches `main` and keeps a release PR current from the Conventional Commit history. Merging it cuts the
`vX.Y.Z` tag and GitHub release; the publish job re-verifies that `dist/` reproduces from `src/` and moves the floating
major tag (`v1`) that consumers reference.

## Notes & caveats

- **All checks must pass, not just required ones.** The gate blocks on _every_ entry in the head commit's status rollup.
  If you run advisory checks that may fail, make them non-failing or filter the rollup in `src/gating.ts`.
- **The "Verified" badge** needs the signer's key known to GitHub. The signature _bytes_ are preserved regardless; the
  badge is the only part that depends on the public key being on the account/org.
- **Pinning.** Consuming repos reference `…/ff-merge.yaml@v1` and the workflow references
  `bitwise-media-group/ff-merge@v1` — the floating major tag the publish job maintains. For the strictest posture, pin
  to a full commit SHA; Dependabot keeps it fresh.
