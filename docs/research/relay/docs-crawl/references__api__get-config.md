# Get Config - Relay

Source: https://docs.relay.link/references/api/get-config

cURL

cURL

curl --request GET \
  --url https://api.relay.link/config/v2
200
500
{
  "enabled": true,
  "user": {
    "balance": "<string>",
    "maxBridgeAmount": "<string>"
  },
  "fee": "<string>",
  "solver": {
    "address": "<string>",
    "balance": "<string>",
    "capacityPerRequest": "<string>"
  },
  "supportsExternalLiquidity": true
}
Deprecated
Get Config

This API returns solver capacity data & user data.

Copy page
GET
https://api.relay.link
https://api.testnets.relay.link
/
config
/
v2
Try it
This API has been replaced by the Get Quote API, which supports bridging, swapping and calling through a single unified API.
Query Parameters
​
originChainId
stringrequired
​
destinationChainId
stringrequired
​
user
string

User address, when supplied returns user balance and max bridge amount

​
currency
enum<string>

Restricts the user balance and capacity to a particular currency when supplied with a currency id. Defaults to the native currency of the destination chain.

Available options: anime, btc, cgt, dai, eth, omi, pop, tg7, tia, usdc, usdc.e, usdt, sol, weth, ape, g7, pengu, plume, plumeusd, gun, somi, synd, xpl, usde, mon, musd, usdm, pyusd, cash, eusd, pusd, bnb, usdg, pathusd, ausd, usdc.e-cronos 
Response
200
application/json

Default Response

​
enabled
boolean
​
user
object

Show child attributes

​
fee
string

Total fee in the native or supplied currency for the bridge operation

​
solver
object

Show child attributes

​
supportsExternalLiquidity
boolean

This denotes if the chain combination supports canonical plus bridging

Was this page helpful?

Yes
No
Get Price
Get Execution Status
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform