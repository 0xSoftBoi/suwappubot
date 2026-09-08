# Troubleshooting - Relay

Source: https://docs.relay.link/references/api/troubleshooting

On this page
Failed Fill Transactions
Step 1: Get the failed data
Step 2: Simulate the transaction in Tenderly
Troubleshooting
Copy page

Troubleshooting tips and tricks for debugging issues with Relay.

​
Failed Fill Transactions
If the fill transaction fails you may get some useful data returned from the requests api:
failedTxHash
failedTxBlockNumber
failedCalldata
You can use these values to simulate the transaction in Tenderly or similar tools to see the exact error message and revert reason.
​
Step 1: Get the failed data
You can also access this data by going to the Relay transaction page and using the Ctrl + i shortcut to open up the full request data.
cURL
Response
curl -X GET "https://api.relay.link/requests/v2?id=0x27714ec23ddd6466f383c77368692f948d7c52d320de03b371d0f310437bcb2a"

​
Step 2: Simulate the transaction in Tenderly
Open up your Tenderly dashboard, click simulator and then new simulation. Then paste in the required datapoints from the values above.
You should then see the simulation rendered in Tenderly with an in depth error message and where the revert happened.

Was this page helpful?

Yes
No
Supported Tokens & Routes
Core
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform