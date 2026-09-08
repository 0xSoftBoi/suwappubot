# Get Usage - Relay

Source: https://docs.relay.link/references/api/get-usage

cURL

cURL

curl --request GET \
  --url 'https://api.relay.link/metrics/usage?granularity=hourly'
200
{
  "metrics": [
    {
      "apiKey": "<string>",
      "timestamp": "<string>",
      "endpoint": "<string>",
      "statusCode": 123,
      "errorCode": "<string>",
      "count": 123
    }
  ]
}
API Reference
Get Usage

This API returns API call counts for the authenticated API key, grouped by endpoint, status code, and error code.

Copy page
GET
https://api.relay.link
https://api.testnets.relay.link
/
metrics
/
usage
Try it
Headers
​
x-api-key
string

Integrator API key.

Query Parameters
​
granularity
enum<string>default:hourly

Time bucket granularity. minutely defaults to last 24h, hourly to last 7d, daily to last 14d.

Available options: minutely, hourly, daily 
​
startTimestamp
number

Start of the query window as a Unix timestamp (seconds). Defaults based on granularity.

​
endTimestamp
number

End of the query window as a Unix timestamp (seconds). Defaults to now.

​
apiKey
string

Filter metrics by API key. Accepts a single value or a comma-separated list (e.g. key1,key2) — results include metrics matching any of the supplied keys. Maximum 50 keys.

Response
200 - application/json

Default Response

​
metrics
object[]

Show child attributes

Was this page helpful?

Yes
No
Claim App Fees
Advanced
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform