# Overview - Relay

Source: https://docs.relay.link/references/protocol/vaults/overview

On this page
How Relay Vaults Work
Working with Vaults
Why Relay Vaults Matter
Vaults
Overview
Copy page

Introducing Relay Vaults

Relay Vaults is a separate protocol from Relay Settlement, focused on liquidity provisioning rather than intent settlement. While Settlement handles the core flow of deposits, fills, and solver payments, Vaults provide the infrastructure solvers use to rebalance their capital across chains.
Relay’s mission is to make transacting across chains as fast, cheap, and simple as online payments. Relay Vaults bring us closer to that vision.
Vaults are permissionless, ERC4626 compliant, yield-bearing pools designed to provide liquidity that solvers use to facilitate faster, cheaper, and more efficient crosschain transactions. By leveraging idle capital from lending markets (e.g., Aave, Morpho), Relay Vaults enable solvers to instantly rebalance liquidity across chains. This improves crosschain withdrawals and rebalancing speed, reduces transaction fees, and ensures stable yield for depositors.
​
How Relay Vaults Work
Depositors provide liquidity by depositing tokens into Relay Vaults, earning a base yield from established lending protocols (Aave currently). Additionally, depositors earn a boost yield when their funds are utilized by solvers for crosschain rebalancing transactions. In essence, Vault capital accrues base yield while idle and earns additional yield when actively supporting solver operations.
Relay Vaults can support multiple chains from a single deployment, enhancing liquidity availability and yield generation. The flexibility to rebalance across numerous L2 and L3 chains further increases yield potential and capital efficiency.
Relay Vaults are particularly beneficial for chains that provide liquidity to a Vault deployed on a popular network, such as Arbitrum. This enables enhanced interoperability for all connected L3 chains, significantly improving crosschain liquidity and user experience on those emerging networks.
Interested in integrating your chain with Relay Vaults or providing liquidity to enhance your network’s interoperability? Contact our team to discuss collaboration opportunities.
​
Working with Vaults
Vaults are composable, making them easy to integrate with other defi protocols and applications. The Relay team has deployed Vaults initially on Ethereum Mainnet and Arbitrum. Users can interact with Vaults via our user interface or directly through smart contracts.
For developers, Relay provides a backend indexing service, simplifying data querying and integration efforts. This service is accessible at https://vaults-api.relay.link/.
Relay Vaults are open-source and available on GitHub. Contributions are welcome.
​
Why Relay Vaults Matter
Instant crosschain liquidity and efficient rebalancing significantly lower transaction costs and improve user experience. Vaults address the slow, costly rebalancing problem that often forces higher fees, particularly on smaller or emerging networks with limited interoperability infrastructure.
Relay Vaults is the next step in Relay’s broader strategy to create seamless crosschain payments.
Explore our first Vaults on Ethereum Mainnet and Arbitrum today, and join us in shaping the future of crosschain commerce.

Was this page helpful?

Yes
No
SVM Depository Reference
Architecture
twitter
Powered by
This documentation is built and hosted on Mintlify, a developer documentation platform