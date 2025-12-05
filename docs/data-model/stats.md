# TicketAI Stats Data Model

## Data Ownership Rules

### `stats_cache` — CANONICAL SOURCE OF TRUTH

**Purpose**: Stores last-5 match averages (goals, corners, cards, fouls, offsides) per team.

**Source**: Computed directly from **API-Football** via `computeLastFiveAverages()` in `_shared/stats.ts`.

**Status**: ✅ **CANONICAL** — This is the authoritative source for all pre-match statistics used throughout TicketAI.

**Validation**: Values have been cross-checked against **Flashscore** (real-world ground truth) and confirmed to match.

**Usage**:
- Filterizer (via `optimized_selections.combined_snapshot`)
- Ticket Creator (via `optimized_selections.combined_snapshot`)
- Fixture Analyzer (via `analyze-fixture` edge function)
- All prediction/model logic

---

### `fixture_results` — SECONDARY HISTORICAL MIRROR

**Purpose**: Best-effort historical archive of finished fixture results, populated via incremental backfill.

**Source**: Populated by `results-refresh` and `fixtures-history-backfill` edge functions.

**Status**: ⚠️ **NOT GUARANTEED** to match API-Football 1:1.

**Known Issues**:
- May have timing differences vs API-Football live data
- Backfill may be incomplete for some leagues/seasons
- Different "last 5 fixtures" set due to timing of data capture

**Usage**:
- Debugging and historical analysis
- Backtest sample generation
- **NOT** for validating `stats_cache` correctness

---

## Critical Rule: Do NOT Use `fixture_results` to Judge `stats_cache`

```
┌─────────────────────────────────────────────────────────────────────┐
│  ❌ WRONG: Compare stats_cache vs fixture_results recomputation    │
│     → fixture_results is a noisy secondary table                   │
│                                                                     │
│  ✅ CORRECT: Compare stats_cache vs fresh API-Football computation │
│     → Both use the same source (API-Football)                      │
│     → Measures internal pipeline consistency                       │
└─────────────────────────────────────────────────────────────────────┘
```

### Why This Matters

When we manually verified stats against **Flashscore** (the real-world ground truth):
- `stats_cache` values **matched** Flashscore
- `fixture_results`-based recomputation **differed** from Flashscore

This proves:
1. `stats_cache` (API-Football based) is correct
2. `fixture_results` has minor discrepancies and must NOT be treated as ground truth

---

## Audit Strategy

The `stats-audit-last-five` edge function compares:
- **A)** `stats_cache` (cached values)
- **B)** Fresh recomputation using `computeLastFiveAverages()` (same API-Football helper used by `stats-refresh`)

This measures **internal pipeline consistency** — ensuring the cache matches what we'd compute today from the same API source.

---

## Data Flow Diagram

```
┌──────────────────┐
│   API-Football   │  ← Source of truth (matches Flashscore)
└────────┬─────────┘
         │
         ▼
┌──────────────────┐     ┌──────────────────┐
│   stats-refresh  │────▶│   stats_cache    │  ← CANONICAL for all features
└──────────────────┘     └────────┬─────────┘
                                  │
                                  ▼
                         ┌──────────────────┐
                         │ optimized_       │  ← combined_snapshot populated
                         │ selections       │     from stats_cache
                         └────────┬─────────┘
                                  │
         ┌────────────────────────┼────────────────────────┐
         ▼                        ▼                        ▼
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   Filterizer     │     │  Ticket Creator  │     │ Fixture Analyzer │
└──────────────────┘     └──────────────────┘     └──────────────────┘
```

```
┌──────────────────┐
│   API-Football   │
│   /fixtures      │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐     ┌──────────────────┐
│ results-refresh  │────▶│ fixture_results  │  ← SECONDARY, for debugging only
│ history-backfill │     │                  │
└──────────────────┘     └──────────────────┘
```

---

## Summary

| Table | Role | Source | Use For |
|-------|------|--------|---------|
| `stats_cache` | **Canonical** | API-Football | All features, predictions, UI |
| `fixture_results` | Secondary | Backfill scripts | Debugging, historical analysis |

**Never** use `fixture_results` to validate whether `stats_cache` is "correct" — the cache is aligned with API-Football and real-world data (Flashscore).
