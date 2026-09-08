# Request Withdrawal - Relay

Source: https://docs.relay.link/references/api/request-withdrawal

cURL

cURL

curl --request POST \
  --url https://api.relay.link/withdrawals/request \
  --header 'Content-Type: application/json' \
  --data '
{
  "chainId": "<string>",
  "currency": "<string>",
  "amount": "<string>",
  "ownerChainId": "<string>",
  "owner": "<string>",
  "recipient": "<string>"
}
'
Withdrawals
Request Withdrawal

Prepare or execute a user-triggered withdrawal from the Relay Depository

Copy page
POST
https://api.relay.link
https://api.testnets.relay.link
/
withdrawals
/
request
Try it
How do programmatic withdrawals work?
Call this endpoint twice per withdrawal: first without signature to prepare (returns the nonce, validated amount, and any additionalData to sign), then with the nonce and owner signature to execute (returns a jobId). chainId and ownerChainId are protocol chain slugs, not numeric ids. These endpoints power relay.link/withdraw and are not yet a versioned API surface.
Body
application/json
​
chainId
stringrequired
Minimum string length: 1
​
currency
stringrequired
Minimum string length: 1
​
amount
stringrequired
Pattern: ^[0-9]+$
​
ownerChainId
stringrequired
Minimum string length: 1
​
owner
stringrequired
Minimum string length: 1
​
recipient
stringrequired
Minimum string length: 1
​
nonce
string
​
additionalData
any
​
signature
string
Response
200

Default Response

Was this page helpful?

Yes
No
Attest Deposit
Get Withdrawal Status
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform