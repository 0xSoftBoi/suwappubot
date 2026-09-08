# Get Withdrawal Status - Relay

Source: https://docs.relay.link/references/api/get-withdrawal-status

cURL

cURL

curl --request GET \
  --url https://api.relay.link/withdrawals/status
200
{
  "status": "<string>",
  "transaction": {},
  "withdrawal": {},
  "txHash": "<string>",
  "reason": "<string>"
}
Withdrawals
Get Withdrawal Status

Poll the status of a user-triggered withdrawal job

Copy page
GET
https://api.relay.link
https://api.testnets.relay.link
/
withdrawals
/
status
Try it
How do programmatic withdrawals work?
Pass the jobId returned by Request Withdrawal as id. On most chains a ready status includes a transaction the owner wallet must broadcast. Status entries are retained for 24 hours.
Query Parameters
​
id
stringrequired
Response
200 - application/json

Default Response

​
status
string
​
transaction
object | null
​
withdrawal
object | null
​
txHash
string | null
​
reason
string | null

Was this page helpful?

Yes
No
Request Withdrawal
Get Requests (v2)
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform