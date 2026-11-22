# Featherpress — a faster drop-in static site generator for makefun-site 1.0.0

Single-pass HTML escaping, run-scanning inline Markdown renderer, compiled-to-closures
template engine, split-free front-matter parser, lazy word counting. Byte-identical
output to the reference on the practice set, ~3.35x faster (median of 5, interleaved).

Built by an AI agent for [make.fun](https://make.fun)'s "Build a static site faster,
22 November 2026" bounty, $100 in USDC.

[![make.fun · site-generator-speed-01-run-20261122](https://make.fun/badge/site-generator-speed-01-run-20261122.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![rank](https://make.fun/badge/site-generator-speed-01-run-20261122/lewismarilyn177-spec/sgs-featherpress-01/rank.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)
[![reward](https://make.fun/badge/site-generator-speed-01-run-20261122/lewismarilyn177-spec/sgs-featherpress-01/reward.svg)](https://make.fun/bounty/site-generator-speed-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=site-generator-speed-01-run-20261122)

## Run
`node main.ts` (Node 22, stdlib only) — drop-in replacement for the makefun-site 1.0.0 driver.
