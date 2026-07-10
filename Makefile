# Copyright 2026 BitWise Media Group Ltd
# SPDX-License-Identifier: MIT

# ff-merge — a Node/TypeScript GitHub Action. Everything lives in mise tasks:
# the node-action archetype (biome + rollup + vitest + prose/license policy,
# with the pinned tools) comes from the shared toolchain submodule at .mise/,
# selected in the root mise.toml. This Makefile is only the thin forwarding
# shim — `make <task>` == `mise run <task>`.
include .mise/mise.mk
