# Copyright 2026 BitWise Media Group Ltd
# SPDX-License-Identifier: MIT

# ff-merge — a TypeScript GitHub Action on bun. Everything lives in mise tasks:
# the node archetype (package.json scripts + prose/license policy, with the
# pinned tools) comes from the shared toolchain submodule at .mise/, selected in
# the root mise.toml. This Makefile is only the thin forwarding shim —
# `make <task>` == `mise run <task>`.
include .mise/archetypes/node/include.mk
