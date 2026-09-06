#!/bin/sh
set -eu

corepack pnpm install --frozen-lockfile
corepack pnpm run docs:build
