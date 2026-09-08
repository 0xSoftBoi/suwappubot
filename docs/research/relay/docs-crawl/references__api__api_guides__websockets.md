# Websockets - Relay

Source: https://docs.relay.link/references/api/api_guides/websockets

On this page
Relay Status Websockets
Integrating Relay Websockets
Events
Authentication
Interacting with the Websocket
Subscribing with Filters
Unsubscribing
Example
Javascript
Integration Guides
Websockets
Copy page

Remove Indexing Latency from your App using Relay Websockets

Our goal at Relay is to make multichain payments feel instant. Even when transactions confirm quickly onchain, API polling latency can degrade user experience. Connecting your app to Relay Websockets means your users get streamed updates of the status of their Relays for a speedier experience.
Websockets stream statuses to a connected client. To have Relay push status updates to your backend instead, configure a webhook.
​
Relay Status Websockets
Relay Status Websockets specifically stream transaction statuses for both cross and same-chain status, though the stages differ slightly.
status	indication
waiting	waiting for origin chain deposit
depositing	origin deposit confirmed via /execute API, fill pending
pending	origin chain deposit confirmed, fill pending submission
submitted	fill submitted on destination chain
success	fill succeeded
failure	fill failed
refund	refunded
​
Integrating Relay Websockets
Refer to the guide below on how to integrate the websocket into your application. You may also refer to the websocket reference for more details.
​
Events
Event	Tags	Event Description
request.status.updated	id	Triggered status of the request changes.
​
Authentication
The Websocket Service uses an API key for authentication and is available at the following URL wss://ws.relay.link
To connect using an API key, provide your API key as a query param in the connection url:
const wss = new ws(`wss://ws.relay.link?apiKey=${YOUR_API_KEY}`);

The websocket server needs to restart to deploy updates
The websocket server uses a rolling restart mechanism to deploy new changes. This will disconnect you and require you to reconnect to the websocket server. There is no downtime, as you are only disconnected once the new server is up and running. Please make sure to include logic in your implementation to handle these restarts, and reconnect accordingly.
​
Interacting with the Websocket
Before sending any messages over the Websocket, wait for a ready message back from the server. The message looks like:
{
	"type": "connection", // The type of operation
	"status": "ready", // The status of the operation
	"data": {
		"id": "9nqpzwmwh86" // Your socket id for debugging purposes
	}
}

​
Subscribing with Filters
Below is an example on how to subscribe to a websocket using filters.
Subscribe
Subscribe Response
{
	"type": "subscribe",
	"event": "request.status.updated",
    "filters": {
        "id": "0xae0827617d4ae75b406969971c2d4df9a8e8d819ff0f09581fb45ca123fcc7a0"
    }
}

​
Unsubscribing
Unsubscribe
Unsubscribe Response
{
	"type": "unsubscribe",
	"event": "request.status.updated",
  "filters": {
      "id": "0xae0827617d4ae75b406969971c2d4df9a8e8d819ff0f09581fb45ca123fcc7a0"
  }
}

Unsubscribing is not required if disconnecting from the websocket as the server cleans up automatically.
​
Example
​
Javascript
npm install ws

const ws = require("ws");

const YOUR_API_KEY = "";

const wss = new ws(`wss://ws.relay.link?apiKey=${YOUR_API_KEY}`);

wss.on("open", function open() {
  console.log("Connected to Relay");

  wss.on("message", function incoming(data) {
    console.log("Message received: ", JSON.stringify(JSON.parse(data)));

    // When the connection is ready, subscribe to the top-bids event
    if (JSON.parse(data).status === "ready") {
      console.log("Subscribing");
      wss.send(
        JSON.stringify({
          type: "subscribe",
          event: "request.status.updated",
          filters: {
            id: "0xae0827617d4ae75b406969971c2d4df9a8e8d819ff0f09581fb45ca123fcc7a0",
          },
        })
      );

      // To unsubscribe, send the following message
      // wss.send(
      //     JSON.stringify({
      //         type: 'unsubscribe',
      //         event: 'request.status.updated',
      //     }),
      // );
    }
  });
});


Was this page helpful?

Yes
No
Deep Linking
Webhooks
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform