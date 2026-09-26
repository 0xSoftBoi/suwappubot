"""RPC endpoints and API keys.  Copy to `networks.py` and fill in.

Deliberately a plain Python module rather than env vars or a dotenv file --
this mirrors the convention in ~/Projects/yb-core (`scripts/voting/networks.py`),
so the same values can be shared between repos by copying one file.

`networks.py` is gitignored.  Nothing in `src/erouter/core/` may read it.
"""

# Ethereum mainnet.  A local node is strongly preferred: the probe pass issues
# ~9k sub-calls in a single eth_call, and public endpoints cap that hard.
NETWORK = "https://eth.llamarpc.com"

ARBITRUM = "https://arb1.arbitrum.io/rpc"
OPTIMISM = "https://mainnet.optimism.io"
BASE = "https://mainnet.base.org"
GNOSIS = "https://rpc.gnosischain.com"
POLYGON = "https://polygon-rpc.com"
FRAXTAL = "https://rpc.frax.com"
SONIC = "https://rpc.soniclabs.com"

# Not needed for routing; kept for parity with yb-core and for future
# contract verification once RouteQuoter.vy is deployed.
ETHERSCAN_API_KEY = "<your-etherscan-api-key>"
