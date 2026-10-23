CONSTRUCTED sample of a Racing Queensland GPS sectional file, modelled on the format described in zuizui0223/keiba
(scripts/ecology_rq_thoroughbred_sectional_audit.py and docs/ecology-rq-thoroughbred-source-audit.md):
  URL pattern : https://www.racingqueensland.com.au/RacingFile.ashx?path=/Sectional/YYYYMMDD_<Venue_With_Underscores>_T.csv
                e.g. 20261010_Eagle_Farm_T.csv, 20261011_Ladbrokes_Cannon_Park_T.csv
  Index page  : https://www.racingqueensland.com.au/industry/thoroughbred/thoroughbred-sectionals
  Not a rectangular CSV. Lines are split on the first two commas (line.split(",", 2)):
    race header : "Date,RaceNumber,<DD/MM/YYYY 12:00:00 AM>;<venue label>;<race title>;<race-level time HH:MM:SS.fff>;<route code>"
    runner line : "<DD/MM/YYYY>,<raceNo>,<horse name>;<cloth number (unverified)>;<marker>;<value>;<section time HH:MM:SS.fff>;<marker>;<value>;<time>;..."
  Interpretation of the per-marker "value" (likely speed) and the exact marker semantics are unverified; an all-zero row means telemetry
  was unavailable, NOT a scratching/DNF. Horse rows carry names only (no HORSES id). Keiba observed the header time differing from the
  official result time (e.g. 00:00:57.263 vs 0:55.06), so treat it as a different measure.
