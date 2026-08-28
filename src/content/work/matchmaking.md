---
title: Matchmaking & Rank Distribution
meta: 'PYTHON / C++ · 6 MONTHS · SOLO'
blurb: >-
  Can a hybrid of machine learning and Bayesian inference out-rank Elo?
  2,500 real matches, 125 players, all 25 Valorant ranks — and a merged
  MARS + TrueSkill-inspired model that most players said felt right.
detail:
  - '2,500 matches · 125 players'
  - Linear + spline analysis
  - MARS regression
  - Bayesian skill priors
  - Season simulation
  - '~89% perceived fairness'
order: 3
card: true
caseStudy: true
media:
  - src: '/media/mm-dealt-headshots.webp'
    alt: 'Scatter plot of headshots dealt per match against all 25 Valorant ranks from Iron 1 to Radiant, with a rising spline of best fit and linear trend line'
    caption: 'Fig. 1 — dealtHeadshots vs rank: steep slope, few inflections — a key stat'
    width: 870
    height: 582
  - src: '/media/mm-headshot-pct.webp'
    alt: 'Scatter plot of headshot percentage against rank with spline and linear fits, trending upward across the ranked spectrum'
    caption: 'Fig. 2 — headshot % vs rank: a clean linear indicator of skill'
    width: 893
    height: 569
  - src: '/media/mm-sim-tenz.webp'
    alt: 'Simulation output for the pro player Tenz: TrueSkill, Bayesian, MARS and merged model rank distributions, with the merged model placing him at the Radiant end'
    caption: 'Fig. 3 — Radiant benchmark: the merged model scales to the top'
    width: 1400
    height: 856
  - src: '/media/mm-sim-iotaxx.webp'
    alt: 'Simulation output for the player Iotaxx: four rank-distribution columns with the merged prediction landing on the actual rank, Platinum 2'
    caption: 'Fig. 4 — Iotaxx: merged prediction lands on the actual rank'
    width: 1400
    height: 832
---

## The question

Competitive games still mostly rank players with Elo-descended systems that
watch one signal: wins. This study asked whether a rating built from what a
player actually *does* in a match — combining machine learning with
probabilistic inference — could place people more fairly than the legacy
systems, using Valorant as the test bed.

## The data

**2,500 competitive matches from 125 players across all 25 ranks**, Iron 1
to Radiant, collected through the Tracker.gg API. Every match carries the
full stat sheet — combat (kills, damage, headshot ratios, trades), economy
(econ rating, thrifties, clutches), utility usage and round context — so the
analysis could ask which numbers actually track skill.

## Finding the signal

Each statistic was plotted against rank twice: once with a linear
regression, once with a spline of best fit. A stat earned "key" status when
its linear slope was steep and its spline barely inflected — meaning it
climbs steadily with rank instead of wobbling. Headshots dealt, damage per
round and headshot percentage passed; flashier stats didn't. The figures
below are the actual plots from the study.

## Three models, one season

A custom simulation framework replays full seasons of matches and lets
rating models compete on the same data:

- **MARS only** — Multivariate Adaptive Regression Splines over the key
  stats: interpretable, non-linear, good at performance arcs.
- **Bayesian only** — a TrueSkill-inspired posterior over skill with
  quantified uncertainty, responsive in early matches.
- **Merged** — MARS-derived scores set the *prior* for the Bayesian
  update: fast convergence with feature-weighted nuance.

The merged hybrid produced the lowest prediction variance of the three, and
in post-simulation surveys **~89% of participants said the merged rank
reflected their true skill** — including a Radiant-level benchmark (the pro
player Tenz) placed correctly at the very top of the ladder.

## Where it breaks

The honest part: unranked accounts with sparse, volatile histories inflated
their predictions — one Silver-level player was placed at Platinum even
after manual correction. The write-up proposes outlier-resistant loss
functions (Huber), minimum-match thresholds, per-role submodels for
Valorant's agent classes, and per-round rather than per-game scaling as the
next iterations.
