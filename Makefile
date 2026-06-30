# Copyright 2026 BitWise Media Group Ltd
# SPDX-License-Identifier: MIT

# Canonical gates for the reusable CI/release workflows (bitwise-media-group/github-workflows),
# which call `make lint` / `make build` / `make test` / `make e2e` unconditionally. Each
# target wraps the repo's npm scripts; the reusable CI sets up node but runs no `npm ci`,
# so every target depends on the node_modules sentinel that installs dependencies first.

.PHONY: lint
lint: node_modules ## check-mode static analysis: biome (lint + format check), markdownlint, tsc
	@ npm run check
	@ npm run typecheck

.PHONY: build
build: node_modules ## bundle the action into dist/ with rollup
	@ npm run build

.PHONY: test
test: node_modules ## vitest with coverage (emits coverage/cobertura-coverage.xml + coverage/junit.xml in CI)
	@ npm run test:coverage

.PHONY: e2e
e2e: ## no-op: running the action for real would move a branch ref, so the gate is unit-tested instead
	@:

.PHONY: fmt
fmt: node_modules ## fix lint/format in place: biome --write, prettier (markdown)
	@ npm run check:fix
	@ npm run format

.PHONY: ci
ci: lint build test ## run the CI gates locally: lint, build, test

node_modules: package.json package-lock.json
	@ npm ci
	@ touch node_modules
