# Copyright 2026 BitWise Media Group Ltd
# SPDX-License-Identifier: MIT

# ff-merge — a Node/TypeScript GitHub Action. The canonical
# lint/build/test/e2e/ci/pr contract comes from the shared Makefile library's
# node-action archetype (bitwise-media-group/make), consumed as the make/
# submodule and included below. ff-merge's biome + rollup + vitest toolchain is
# exactly what the archetype drives, so there are no repo-local targets.
include make/node-action.mk
