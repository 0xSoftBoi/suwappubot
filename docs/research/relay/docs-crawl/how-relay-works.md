# How Relay Works - Relay

Source: https://docs.relay.link/how-relay-works

On this page
The Relay Stack
Introduction
How Relay Works
Copy page

Learn how Relay quotes, routes, executes, and settles onchain transactions

Relay coordinates payments, swaps, bridges, and onchain calls from quote through completion.
Quote: The application requests a quote for the user’s intended outcome. Relay returns the expected result, total cost, and the steps required to complete the transaction.
Execute: The user signs the transaction steps included in the quote. Same-chain transactions execute directly on the source chain. For cross-chain transactions, execution deposits the user’s funds and order into the Relay Depository Contract.
Fill: For a cross-chain transaction, a solver completes the requested action on the destination chain while the user’s funds remain in the Relay Depository Contract.
Settle: After the solver proves the fill onchain, the protocol releases the deposited funds to the solver.
Applications can track every transaction through completion, regardless of its route.
​
The Relay Stack
Relay API
Request quotes, execute transactions, track status, and retrieve supported network data.
RelayKit
Use the SDK, React hooks, and UI components to add Relay to your application.
Relay Protocol
Learn how the non-custodial protocol coordinates users, solvers, and smart contracts.
Relay App
Explore supported routes and transact through the same infrastructure available to integrators.

Was this page helpful?

Yes
No
What is Relay?
Payment Service Providers
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform