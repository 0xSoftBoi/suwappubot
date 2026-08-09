#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataPath = path.join(here, '..', 'data', 'erc8056-public-code-audit.json');
const audit = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const search = audit.github_search;
const fixture = audit.official_split_fixture;

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

invariant(audit.standard_state === 'DRAFT', 'expected Draft standard state');
invariant(search.repositories.length === 9, 'expected nine repositories');
invariant(search.queries.length === 8, 'expected eight canonical queries');
invariant(search.queries.every((item) => item.matches === 0), 'expected zero canonical matches');
invariant(search.positive_control.matches_returned > 0, 'positive control must return indexed code');
invariant(audit.suwappu_prechange_search.matches === 0, 'expected zero pre-change Suwappu matches');

const balance = Number(fixture.raw_token_balance_after);
const multiplier = Number(fixture.ui_multiplier_after);
const rawSharePrice = Number(fixture.underlying_share_price_after_usd);
const tokenFeedPrice = Number(fixture.chainlink_token_price_after_usd);

invariant(balance * multiplier === Number(fixture.share_equivalent_after), 'share-equivalent mismatch');
invariant(balance * rawSharePrice === 20, 'raw REST valuation fixture mismatch');
invariant(balance * tokenFeedPrice === 200, 'correct token valuation fixture mismatch');
invariant(balance * tokenFeedPrice * multiplier === 2000, 'double-adjusted valuation fixture mismatch');

console.log(
  'erc8056 audit OK: 9 repos, 8 zero-match canonical queries, positive control present, split fixture reconciles',
);
