// Fixture generator: builds a GitHub pull_request webhook payload + HMAC signature, prints the
// arbiter-wasm stdin JSON. Usage:
//   node make-fixture.mjs pass|fail-author|fail-unmerged|fail-deadline > fixture-pass.json
import { createHmac, createHash } from 'node:crypto';

const SECRET = 'arbiter-demo-secret';
const kind = process.argv[2] || 'pass';

const now = new Date('2026-11-05T12:00:00Z');

const pr = {
  number: 7,
  merged: true,
  merged_at: now.toISOString(),
  user: { login: 'octocat' },
  merged_by: { login: 'hubot' },
  head: { ref: 'feature/milestone' },
};

if (kind === 'fail-author') pr.user.login = 'mallory';
if (kind === 'fail-unmerged') { pr.merged = false; pr.merged_at = null; }

const payload = JSON.stringify({
  action: 'closed',
  pull_request: pr,
  repository: { full_name: 'arbiter-demo/shop', html_url: 'https://github.com/arbiter-demo/shop' },
  sender: { login: 'hubot' },
});

const signature = 'sha256=' + createHmac('sha256', SECRET).update(payload).digest('hex');
const payload_b64 = Buffer.from(payload).toString('base64');
const signature_hex = signature.replace(/^sha256=/, '');

const deadline = kind === 'fail-deadline'
  ? Math.floor(new Date('2026-10-31T00:00:00Z').getTime() / 1000) // merged after deadline
  : Math.floor(new Date('2026-11-30T00:00:00Z').getTime() / 1000);

const input = {
  context: 'github_pr',
  repo: 'arbiter-demo/shop',
  pr_number: 7,
  author: 'octocat',
  deadline_unix: deadline,
  payload_b64,
  signature_hex,
};
console.log(JSON.stringify(input));
