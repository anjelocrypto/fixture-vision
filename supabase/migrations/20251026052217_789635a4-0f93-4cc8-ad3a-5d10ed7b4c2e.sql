-- One-time cleanup: remove pre-band rows from 48h prematch window
DELETE FROM optimized_selections
WHERE is_live = false
  AND utc_kickoff BETWEEN now() AND now() + interval '48 hours'
  AND (odds < 1.25 OR odds > 5.00);