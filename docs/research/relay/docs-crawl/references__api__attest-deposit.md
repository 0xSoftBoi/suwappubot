# Attest Deposit - Relay

Source: https://docs.relay.link/references/api/attest-deposit

cURL

cURL

curl --request POST \
  --url https://api.relay.link/withdrawals/attest-deposit \
  --header 'Content-Type: application/json' \
  --data '
{
  "chainId": 123,
  "transactionId": "<string>"
}
'
Withdrawals
Attest Deposit

Attest a deposit transaction so its funds become claimable via the withdrawal flow

Copy page
POST
https://api.relay.link
https://api.testnets.relay.link
/
withdrawals
/
attest-deposit
Try it
How do programmatic withdrawals work?
Unlike the other withdrawal endpoints, chainId here is the numeric Relay chain id. These endpoints power relay.link/withdraw and are not yet a versioned API surface.
Body
application/json
​
chainId
numberrequired
​
transactionId
stringrequired
Response
200

Default Response

Was this page helpful?

Yes
No
Gasless Execution
Request Withdrawal
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform