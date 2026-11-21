-- Suwappu traction snapshot. READ-ONLY: aggregates only, no PII, no keys.
-- Exception: section 9 lists agent names (operator-chosen labels) and their request counts.
-- Run (from a machine with the Railway CLI linked to project "suwappu", env production):
--   railway connect Postgres  < scripts/traction_queries.sql
-- or:
--   PGOPTIONS='-c default_transaction_read_only=on' psql "$DATABASE_PUBLIC_URL" -f scripts/traction_queries.sql
-- Each statement stands alone, so a missing table only fails that one query.
\set ON_ERROR_STOP off
\pset pager off
SET default_transaction_read_only = on;

\echo '== 1. Users'
SELECT count(*) AS total_users,
       count(*) FILTER (WHERE telegram_id IS NOT NULL) AS telegram,
       count(*) FILTER (WHERE passkey_credential_id IS NOT NULL) AS passkey_web,
       count(*) FILTER (WHERE created_at > now() - interval '30 days') AS new_30d,
       count(*) FILTER (WHERE created_at > now() - interval '90 days') AS new_90d,
       count(*) FILTER (WHERE last_active_at > now() - interval '7 days')  AS active_7d,
       count(*) FILTER (WHERE last_active_at > now() - interval '30 days') AS active_30d,
       count(*) FILTER (WHERE last_active_at > now() - interval '90 days') AS active_90d,
       min(created_at) AS first_user, max(created_at) AS last_signup
FROM users;

\echo '== 2. Users by signup month (last 12)'
SELECT date_trunc('month', created_at)::date AS month, count(*) AS signups
FROM users WHERE created_at > now() - interval '12 months' GROUP BY 1 ORDER BY 1;

\echo '== 3. Swaps: status mix, all time'
SELECT status, count(*) AS n, round(sum(coalesce(from_amount_usd,0))::numeric, 2) AS usd
FROM swap_transactions GROUP BY 1 ORDER BY 2 DESC;

\echo '== 4. Completed swaps by window (completed/confirmed/success-like statuses)'
SELECT
  count(*) FILTER (WHERE coalesce(completed_at, created_at) > now() - interval '7 days')  AS swaps_7d,
  count(*) FILTER (WHERE coalesce(completed_at, created_at) > now() - interval '30 days') AS swaps_30d,
  count(*) FILTER (WHERE coalesce(completed_at, created_at) > now() - interval '90 days') AS swaps_90d,
  count(*) AS swaps_all,
  count(DISTINCT user_id) FILTER (WHERE coalesce(completed_at, created_at) > now() - interval '7 days')  AS swappers_7d,
  count(DISTINCT user_id) FILTER (WHERE coalesce(completed_at, created_at) > now() - interval '30 days') AS swappers_30d,
  count(DISTINCT user_id) FILTER (WHERE coalesce(completed_at, created_at) > now() - interval '90 days') AS swappers_90d,
  count(DISTINCT user_id) AS swappers_all,
  round(sum(coalesce(from_amount_usd,0)) FILTER (WHERE coalesce(completed_at, created_at) > now() - interval '30 days')::numeric, 2) AS usd_30d,
  round(sum(coalesce(from_amount_usd,0)) FILTER (WHERE coalesce(completed_at, created_at) > now() - interval '90 days')::numeric, 2) AS usd_90d,
  round(sum(coalesce(from_amount_usd,0))::numeric, 2) AS usd_all,
  max(completed_at) AS last_completed_swap
FROM swap_transactions
WHERE status IN ('completed','confirmed','success','finalized');

\echo '== 5. Completed swaps per week, last 16 weeks'
SELECT date_trunc('week', created_at)::date AS week, count(*) AS swaps,
       count(DISTINCT user_id) AS swappers, round(sum(coalesce(from_amount_usd,0))::numeric, 2) AS usd
FROM swap_transactions
WHERE status IN ('completed','confirmed','success','finalized') AND created_at > now() - interval '16 weeks'
GROUP BY 1 ORDER BY 1;

\echo '== 6. Concentration: top 10 swappers share of 90d volume (no user ids)'
WITH v AS (SELECT user_id, sum(coalesce(from_amount_usd,0)) usd, count(*) n FROM swap_transactions
           WHERE status IN ('completed','confirmed','success','finalized') AND created_at > now() - interval '90 days'
           GROUP BY 1)
SELECT n, round(usd::numeric,2) usd, round((100*usd/nullif(sum(usd) OVER (),0))::numeric,1) AS pct
FROM v ORDER BY usd DESC LIMIT 10;

\echo '== 7. Agent-originated swaps vs human, and by chain / provider (90d)'
SELECT (agent_id IS NOT NULL OR agent_uuid IS NOT NULL) AS via_agent, from_chain, route_provider,
       count(*) n, round(sum(coalesce(from_amount_usd,0))::numeric,2) usd
FROM swap_transactions
WHERE status IN ('completed','confirmed','success','finalized') AND created_at > now() - interval '90 days'
GROUP BY 1,2,3 ORDER BY n DESC LIMIT 25;

\echo '== 8. Fees recorded'
SELECT count(*) n,
       round(sum(coalesce(fee_amount_usd,0))::numeric,2) AS fee_usd_all,
       round(sum(coalesce(fee_amount_usd,0)) FILTER (WHERE created_at > now() - interval '30 days')::numeric,2) AS fee_usd_30d,
       round(sum(coalesce(fee_amount_usd,0)) FILTER (WHERE created_at > now() - interval '90 days')::numeric,2) AS fee_usd_90d,
       count(*) FILTER (WHERE collected) AS collected_rows,
       round(sum(coalesce(fee_amount_usd,0)) FILTER (WHERE collected)::numeric,2) AS collected_usd
FROM fee_transactions;

\echo '== 9. Agents / API keys'
SELECT count(*) total_agents,
       count(*) FILTER (WHERE is_active) active_flag,
       count(*) FILTER (WHERE last_seen_at > now() - interval '30 days') seen_30d,
       count(*) FILTER (WHERE last_seen_at > now() - interval '7 days') seen_7d,
       count(*) FILTER (WHERE total_requests > 10) gt10_requests,
       sum(total_requests) total_requests, sum(total_swaps) total_swaps,
       max(last_seen_at) last_seen
FROM agents;
SELECT id, left(name,40) AS name, rate_limit_tier, total_requests, total_swaps, created_at::date, last_seen_at::date
FROM agents ORDER BY total_requests DESC NULLS LAST LIMIT 15;

\echo '== 10. Paid: subscriptions, x402, credits'
SELECT tier, count(*) n, count(*) FILTER (WHERE expires_at > now()) unexpired,
       count(*) FILTER (WHERE stripe_customer_id IS NOT NULL) stripe_linked, sum(api_calls_total) api_calls
FROM subscriptions GROUP BY 1 ORDER BY 2 DESC;
SELECT status, product_type, count(*) n, round(sum(amount)::numeric,2) amount, max(created_at) last
FROM x402_payments GROUP BY 1,2 ORDER BY 3 DESC;
SELECT count(*) AS consumed_payments, max(created_at) last FROM consumed_payments;

\echo '== 11. api-ts usage table (if present)'
SELECT * FROM api_usage_daily ORDER BY 1 DESC LIMIT 20;

\echo '== 12. Other activity tables, row counts + last 30d'
SELECT 'limit_orders' t, count(*), count(*) FILTER (WHERE created_at > now()-interval '30 days') FROM limit_orders
UNION ALL SELECT 'dca_orders', count(*), count(*) FILTER (WHERE created_at > now()-interval '30 days') FROM dca_orders
UNION ALL SELECT 'price_alerts', count(*), count(*) FILTER (WHERE created_at > now()-interval '30 days') FROM price_alerts
UNION ALL SELECT 'copy_follows', count(*), count(*) FILTER (WHERE created_at > now()-interval '30 days') FROM copy_follows
UNION ALL SELECT 'referrals', count(*), count(*) FILTER (WHERE created_at > now()-interval '30 days') FROM referrals
UNION ALL SELECT 'wallets', count(*), count(*) FILTER (WHERE created_at > now()-interval '30 days') FROM wallets;

\echo '== 13. Largest tables (where does data actually accumulate?)'
SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 25;
