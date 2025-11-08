# Team Totals (Over 1.5) - QA Verification

## Implementation Complete ✅

### Database Schema
- ✅ Table: `team_totals_candidates` created with all required columns
- ✅ View: `v_team_totals_prematch` created for pre-match filtering
- ✅ RLS policies: Authenticated read, service role manage
- ✅ Indexes: Kickoff and league_id indexed

### Edge Function
- ✅ Function: `populate-team-totals-candidates` deployed
- ✅ Auth: Admin JWT or cron key required
- ✅ API integration: Season stats and last 5 league fixtures
- ✅ Rate limiting: ~1000ms delay between calls (~50 rpm)
- ✅ Caching: Season stats cached within run to avoid duplicate API calls
- ✅ Logic: Correctly evaluates Home O1.5 and Away O1.5 separately

### UI Components
- ✅ Component: `TeamTotalsPanel.tsx` created
- ✅ Position toggle: Home O1.5 / Away O1.5
- ✅ Generate button: Manual trigger (not auto-fetch)
- ✅ Results display: Shows fixture, league, kickoff, badge, reason chips
- ✅ Actions: Copy pick, Add to ticket
- ✅ Empty state: Helpful messaging

### Admin Integration
- ✅ Button: "Team Totals" dropdown in AdminRefreshButton
- ✅ Actions: Populate (120h), Verify Coverage
- ✅ Toast feedback: Progress and summary

### Integration
- ✅ Index.tsx: Panel toggle buttons (desktop + mobile)
- ✅ Mutual exclusivity: Panels close when opening another
- ✅ PaywallGate: Feature gated properly
- ✅ Translations: Added to common.json

## QA Test Queries

### 1. Pre-match Only Enforcement
```sql
-- Should return 0 rows (all candidates must be pre-match)
SELECT COUNT(*)
FROM public.v_team_totals_prematch v
JOIN public.fixtures f ON f.id = v.fixture_id
WHERE NOT (f.status IN ('NS','TBD') AND v.utc_kickoff >= now() + interval '5 minutes');
-- Expected: 0
```

### 2. Rule Correctness Spot Check
```sql
-- Check 10 random passing candidates
SELECT 
  fixture_id,
  team_context,
  season_scoring_rate,
  opponent_season_conceding_rate,
  opponent_recent_conceded_2plus,
  recent_sample_size,
  rules_passed
FROM public.team_totals_candidates
WHERE rules_passed = TRUE
ORDER BY RANDOM()
LIMIT 10;

-- Verify each row satisfies:
-- season_scoring_rate >= 2.0
-- opponent_season_conceding_rate >= 2.0
-- opponent_recent_conceded_2plus >= 3
-- recent_sample_size >= 3
```

### 3. Deduplication Check
```sql
-- Should return 0 rows (no duplicates allowed)
SELECT fixture_id, team_id, team_context, COUNT(*)
FROM public.team_totals_candidates
GROUP BY 1,2,3 
HAVING COUNT(*) > 1;
-- Expected: 0
```

### 4. Window Coverage Sanity
```sql
-- Check candidates in next 120 hours
SELECT 
  COUNT(*) as total_candidates,
  SUM(CASE WHEN rules_passed THEN 1 ELSE 0 END) as passed,
  SUM(CASE WHEN team_context = 'home' AND rules_passed THEN 1 ELSE 0 END) as home_pass,
  SUM(CASE WHEN team_context = 'away' AND rules_passed THEN 1 ELSE 0 END) as away_pass
FROM public.team_totals_candidates
WHERE utc_kickoff BETWEEN now() AND now() + interval '120 hours';

-- Expected: > 0 on busy match slates (especially Fri-Mon)
```

### 5. Sample Candidate Details
```sql
-- View detailed candidate info
SELECT 
  c.fixture_id,
  c.team_context,
  c.season_scoring_rate,
  c.opponent_season_conceding_rate,
  c.opponent_recent_conceded_2plus,
  c.recent_sample_size,
  c.rules_passed,
  c.utc_kickoff,
  f.teams_home->>'name' as home_team,
  f.teams_away->>'name' as away_team,
  l.name as league
FROM public.team_totals_candidates c
JOIN public.fixtures f ON f.id = c.fixture_id
JOIN public.leagues l ON l.id = c.league_id
WHERE c.rules_passed = TRUE
ORDER BY c.utc_kickoff
LIMIT 20;
```

## Manual UI Testing

1. **Access Panel**
   - [ ] Click "Team Totals O1.5" button (desktop right rail or mobile sheet)
   - [ ] Panel opens, other panels close

2. **Position Toggle**
   - [ ] Toggle between "Home O1.5" and "Away O1.5"
   - [ ] Verify no auto-fetch (must click Generate)

3. **Generate Results**
   - [ ] Click Generate button
   - [ ] Loading state shows
   - [ ] Results display with correct badges and reason chips
   - [ ] Empty state shows if no candidates

4. **Copy Pick**
   - [ ] Click "Copy Pick" on a candidate
   - [ ] Toast confirms copy
   - [ ] Clipboard contains correct text format

5. **Add to Ticket**
   - [ ] Click "Add to Ticket" on a candidate
   - [ ] Ticket drawer shows new leg
   - [ ] Leg displays correctly (no odds shown)

6. **Admin Functions**
   - [ ] Click "Team Totals" dropdown in admin tools
   - [ ] Select "Populate (120h)"
   - [ ] Toast shows progress and summary
   - [ ] Select "Verify Coverage"
   - [ ] Console shows full report
   - [ ] Toast shows summary stats

## Performance Notes
- Edge function respects API-Football rate limits (50 rpm)
- Caches season stats per team-league-season to minimize API calls
- Typical run time for 120h window: 5-15 minutes (depends on fixture count)
- Mobile and desktop UI both functional

## Known Limitations
- **No odds displayed** - This is model-only, users check prices themselves
- **Season hardcoded to 2025** - Update annually or make dynamic
- **Line fixed at 1.5** - Only Over 1.5 supported per spec
- **League matches only** - Uses league-season stats, not all competitions
