# Soul Wallet Bug Bounty Program

## Overview

As of August 20th, 2024, the [soulwallet-core](https://github.com/Soulwallet/soulwallet-core) and [soul-wallet-contract](https://github.com/SoulWallet/soul-wallet-contract) repositories are included in the Soulwallet Bug Bounty Program (the “Program”) to encourage the responsible disclosure of vulnerabilities.

The Program is focused exclusively on critical and high-severity bugs, with rewards of up to $50,000. Good luck and happy hunting!

## Scope

The Program is limited to bugs that fall under the following categories:

**Critical**

- Direct theft of any user funds
- Permanent freezing of funds
- Permanent freezing of NFTs
- Unauthorized spending of user funds without access to user keys

**High**

- Temporary freezing of funds
- Temporary freezing of NFTs

**Temporary Exclusion**

- We are aware of issues related to `FCL_elliptic.sol` and are currently working on modifications. Until these modifications are completed, we will not be accepting bug submissions related to `FCL_elliptic.sol`. Thank you for your understanding.

The following items are not covered under this Program:

- Any contract found under the `contracts/test` directory.
- Bugs in any third-party contracts or platforms interacting with Soulwallet.
- Issues already reported or discovered in contracts created by third parties on Soulwallet.
- Previously reported vulnerabilities.

Additionally, vulnerabilities depending on any of the following are also excluded from this Program:

- Frontend issues
- Denial-of-Service (DoS) attacks
- Spam attacks
- Phishing
- Automated tools (e.g., GitHub Actions, AWS, etc.)
- Compromise or misuse of third-party systems or services

## Rewards

Rewards will be determined based on the severity of the reported bug and will be assessed and allocated at the discretion of the Soulwallet team. For critical vulnerabilities that could result in user fund losses, rewards of up to $50,000 may be awarded. Lower severity issues will be rewarded at the team's discretion.

## Reward Calculation for High-Level Reports

High-severity vulnerabilities related to the theft or permanent freezing of unclaimed yield or royalties are evaluated based on the total amount of funds at risk, up to the maximum high-severity reward. This approach is designed to motivate security researchers to identify and report vulnerabilities that may not have significant monetary value at present but could pose a serious threat to the project if left unresolved.

For critical bugs, a reward of USD $50,000 will be granted, but only if the impact results in:

- A loss of funds through an attack that does not require any user intervention
- The leakage of private keys or the exposure of key generation processes leading to unauthorized access to user funds

All other impacts classified as Critical will receive a flat reward of USD $5,000. The remaining severity levels will be compensated according to the Impact in Scope table.

## Disclosure

All discovered vulnerabilities must be reported exclusively to the following email: [security@soulwallet.io](mailto:security@soulwallet.io).

The vulnerability must not be publicly disclosed or shared with anyone else until Soulwallet has been informed, the issue has been resolved, and permission for public disclosure has been granted. Furthermore, disclosure must occur within 24 hours of discovering the vulnerability.

A detailed report of the vulnerability increases the likelihood of receiving a reward and may lead to a higher reward amount. Please include as much information as possible about the vulnerability, such as:

- The conditions under which the bug can be reproduced.
- Steps required to reproduce the bug, or even better, a proof of concept.
- The potential impact if the vulnerability were to be exploited.

Anyone who reports a unique, previously undisclosed vulnerability that results in a change to the code or a configuration change, and who keeps the vulnerability confidential until it has been resolved by our engineers, will be publicly acknowledged for their contribution if they wish.

## Eligibility

To qualify for a reward under this Program, you must:

- Be the first to disclose the unique vulnerability to [security@soulwallet.io](mailto:security@soulwallet.io), in accordance with the disclosure requirements above. If similar vulnerabilities are reported within the same 24-hour period, rewards will be divided at Soulwallet's discretion.
- Provide sufficient information for our engineers to reproduce and fix the vulnerability.
- Not engage in any unlawful conduct when disclosing the bug, including through threats, demands, or other coercive tactics.
- Not exploit the vulnerability in any way, including making it public or profiting from it (other than receiving a reward under this Program).
- Make a good faith effort to avoid privacy violations, data destruction, or interruption or degradation of Soulwallet.
- Submit only one vulnerability per report, unless it is necessary to chain vulnerabilities to demonstrate impact.
- Not submit a vulnerability caused by an underlying issue that has already been rewarded under this Program.
- Not be a current or former employee, vendor, or contractor of Soulwallet, or an employee of any of our vendors or contractors.
- Not be subject to U.S. sanctions or reside in a U.S.-embargoed country.
- Be at least 18 years old or, if younger, submit the vulnerability with the consent of a parent or guardian.

## Other Terms

By submitting a report, you grant Soulwallet all rights necessary, including intellectual property rights, to validate, mitigate, and disclose the vulnerability. All reward decisions, including eligibility and amounts of rewards and the method of payment, are at our sole discretion.

The terms and conditions of this Program may be changed at any time.
