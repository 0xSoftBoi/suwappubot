-- Backfill `reference` on legacy level_up point_transactions rows that predate
-- the idempotency key added alongside point_transactions_user_reference_idx
-- (0018_moaning_blue_marvel.sql). Those rows have reference IS NULL, so they
-- are invisible to the ON CONFLICT (user_id, reference) guard in
-- awardLevelUpBonusTx -- a duplicate level_up award for a user who already
-- has an un-keyed row would insert a second (now-keyed) row instead of
-- conflicting with it.
--
-- Dedupe-first: for any (user_id, newLevel) pair with more than one legacy
-- level_up row, only the earliest (MIN id) gets the reference backfilled.
-- This is intentional, not incidental -- if we backfilled every duplicate,
-- the unique index create/backfill would either violate itself or (with
-- ON CONFLICT) silently leave the later duplicates NULL and unfixed. Picking
-- the earliest row as canonical also matches "first time this level was
-- reached" semantics. Idempotent: `reference IS NULL` in the WHERE clause
-- means re-running this after a partial run only touches rows still unset.
UPDATE point_transactions pt
SET reference = 'level_up:' || (pt.metadata ->> 'newLevel')
WHERE pt.action = 'level_up'
	AND pt.reference IS NULL
	AND pt.metadata ->> 'newLevel' IS NOT NULL
	AND pt.id = (
		SELECT MIN(pt2.id)
		FROM point_transactions pt2
		WHERE pt2.user_id = pt.user_id
			AND pt2.action = 'level_up'
			AND pt2.metadata ->> 'newLevel' = pt.metadata ->> 'newLevel'
	);
