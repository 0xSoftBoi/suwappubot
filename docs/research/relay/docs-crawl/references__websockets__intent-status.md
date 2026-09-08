# Intent Status - Relay

Source: https://docs.relay.link/references/websockets/intent-status

Messages
Subscribe request
Unsubscribe request
Connection ready
Subscribe response
Request status updated event
Unsubscribe response
Websockets
Intent Status

Stream transaction statuses for Relay transactions.

Copy page
WSS
relay-ws
Connect
Send
SubscribeRequest
type:
object
show 3 properties

Client requests subscription to real-time transaction status events.

UnsubscribeRequest
type:
object
show 3 properties

Client unsubscribes from request.status.updated events. Not required if disconnecting from the websocket as the server cleans up automatically.

Receive
ConnectionReady
type:
object
show 3 properties

Sent by the server when the WebSocket connection is ready.

SubscribeResponse
type:
object
show 3 properties

Server acknowledges a successful subscription.

RequestStatusUpdatedEvent
type:
object
show 3 properties

Server pushes real-time transaction status events.

UnsubscribeResponse
type:
object
show 3 properties

Server confirms unsubscription.

Was this page helpful?

Yes
No
Get Quote
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform