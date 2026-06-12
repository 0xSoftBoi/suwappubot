from dataclasses import dataclass
from typing import Optional

from bot.config import starknet_addresses


@dataclass
class TokenConfig:
    """Configuration for a token."""

    symbol: str
    name: str
    decimals: int
    addresses: dict[str, str]  # chain_name -> token_address
    logo_emoji: str
    is_stablecoin: bool = True


# Native token address placeholder (used by Li.Fi)
NATIVE_TOKEN_ADDRESS = "0x0000000000000000000000000000000000000000"

# Stablecoin configurations with addresses per chain
TOKENS: dict[str, TokenConfig] = {
    "USDT": TokenConfig(
        symbol="USDT",
        name="Tether USD",
        decimals=6,
        addresses={
            "ethereum": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
            "bsc": "0x55d398326f99059fF775485246999027B3197955",
            "polygon": "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
            "arbitrum": "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
            "optimism": "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",
            "base": "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
            "solana": "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
            "tron": "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
            "plasma": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
            "starknet": starknet_addresses.USDT,
            "goat": "0xE1AD845D93853fff44990aE0DcecD8575293681e",  # 6 decimals on GOAT
        },
        logo_emoji="💵",
    ),
    "USDC": TokenConfig(
        symbol="USDC",
        name="USD Coin",
        decimals=6,
        addresses={
            "ethereum": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
            "bsc": "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
            "polygon": "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
            "arbitrum": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
            "optimism": "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
            "base": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            "solana": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            "tron": "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8",
            "plasma": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
            "starknet": starknet_addresses.USDC,
            # GOAT's canonical USDC is bridged USDC.e (6 decimals)
            "goat": "0x3022b87ac063DE95b1570F46f5e470F8B53112D8",
        },
        logo_emoji="💲",
    ),
    "DAI": TokenConfig(
        symbol="DAI",
        name="Dai Stablecoin",
        decimals=18,
        addresses={
            "ethereum": "0x6B175474E89094C44Da98b954EedeA397C5daBE9",
            "bsc": "0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3",
            "polygon": "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
            "arbitrum": "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
            "optimism": "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
            "base": "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
        },
        logo_emoji="🟨",
    ),
    "BUSD": TokenConfig(
        symbol="BUSD",
        name="Binance USD",
        decimals=18,
        addresses={
            "bsc": "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56",
        },
        logo_emoji="🟡",
    ),
    "FRAX": TokenConfig(
        symbol="FRAX",
        name="Frax",
        decimals=18,
        addresses={
            "ethereum": "0x853d955aCEf822Db058eb8505911ED77F175b99e",
            "bsc": "0x90C97F71E18723b0Cf0dfa30ee176Ab653E89F40",
            "polygon": "0x45c32fA6DF82ead1e2EF74d17b76547EDdFaFF89",
            "arbitrum": "0x17FC002b466eEc40DaE837Fc4bE5c67993ddBd6F",
            "optimism": "0x2E3D870790dC77A83DD1d18184Acc7439A53f475",
        },
        logo_emoji="⚫",
    ),
    "TUSD": TokenConfig(
        symbol="TUSD",
        name="TrueUSD",
        decimals=18,
        addresses={
            "ethereum": "0x0000000000085d4780B73119b644AE5ecd22b376",
            "bsc": "0x14016E85a25aeb13065688cAFB43044C2ef86784",
            "polygon": "0x2e1AD108fF1D8C782fcBbB89AAd783aC49586756",
            "arbitrum": "0x4D15a3A2286D883AF0AA1B3f21367843FAc63E07",
        },
        logo_emoji="💙",
    ),
    "LUSD": TokenConfig(
        symbol="LUSD",
        name="Liquity USD",
        decimals=18,
        addresses={
            "ethereum": "0x5f98805A4E8be255a32880FDeC7F6728C6568bA0",
            "arbitrum": "0x93b346b6BC2548dA6A1E7d98E9a421B42541425b",
            "optimism": "0xc40F949F8a4e094D1b49a23ea9241D289B7b2819",
        },
        logo_emoji="🔵",
    ),
    "PYUSD": TokenConfig(
        symbol="PYUSD",
        name="PayPal USD",
        decimals=6,
        addresses={
            "ethereum": "0x6c3ea9036406852006290770BEdFcAbA0e23A0e8",
            "solana": "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo",
        },
        logo_emoji="🅿️",
    ),
    "GHO": TokenConfig(
        symbol="GHO",
        name="Aave GHO",
        decimals=18,
        addresses={
            "ethereum": "0x40D16FC0246aD3160Ccc09B8D0D3A2cD28aE6C2f",
            "arbitrum": "0x7dfF72693f6A4149b17e7C6314655f6A9F7c8B33",
        },
        logo_emoji="👻",
    ),
    "USDD": TokenConfig(
        symbol="USDD",
        name="Decentralized USD",
        decimals=18,
        addresses={
            "ethereum": "0x0C10bF8FcB7Bf5412187A595ab97a3609160b5c6",
            "bsc": "0xd17479997F34dd9156Deef8F95A52D81D265be9c",
            "tron": "TPYmHEhy5n8TCEfYGqW2rPxsghSfzghPDn",
        },
        logo_emoji="🟢",
    ),
    "USDP": TokenConfig(
        symbol="USDP",
        name="Pax Dollar",
        decimals=18,
        addresses={
            "ethereum": "0x8E870D67F660D95d5be530380D0eC0bd388289E1",
        },
        logo_emoji="💚",
    ),
    "EURC": TokenConfig(
        symbol="EURC",
        name="Euro Coin",
        decimals=6,
        addresses={
            "ethereum": "0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c",
            "base": "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42",
            "solana": "HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr",
        },
        logo_emoji="💶",
        is_stablecoin=True,
    ),
    "CRVUSD": TokenConfig(
        symbol="CRVUSD",
        name="Curve USD",
        decimals=18,
        addresses={
            "ethereum": "0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E",
            "arbitrum": "0x498Bf2B1e120FeD3ad3D42EA2165E9b73f99C1e5",
            "optimism": "0xc52D7F23a2e460248Db6eE192Cb23dD12bDDCbf6",
            "polygon": "0xc4Ce1D6F5D98D65eE25Cf85e9F2E9DcFEe6Cb5d6",
            "base": "0x417Ac0e078398C154EdFadD9Ef675d30Be60Af93",
        },
        logo_emoji="🔴",
    ),
    "FDUSD": TokenConfig(
        symbol="FDUSD",
        name="First Digital USD",
        decimals=18,
        addresses={
            "ethereum": "0xc5f0f7b66764F6ec8C8Dff7BA683102295E16409",
            "bsc": "0xc5f0f7b66764F6ec8C8Dff7BA683102295E16409",
        },
        logo_emoji="🟠",
    ),
    "USDe": TokenConfig(
        symbol="USDe",
        name="Ethena USDe",
        decimals=18,
        addresses={
            "ethereum": "0x4c9EDD5852cd905f086C759E8383e09bff1E68B3",
            "arbitrum": "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34",
            "base": "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34",
        },
        logo_emoji="🟣",
    ),
    # === Tempo TIP-20 Stablecoins (mainnet live March 18, 2026) ===
    # NOTE: These are TIP-20 tokens, NOT ERC-20. Circle USDC and Tether USDT
    # are NOT yet deployed on Tempo. pathUSD is the primary payment token.
    # Keys are uppercase for get_token_address() / get_token_by_symbol() lookups.
    "PATHUSD": TokenConfig(
        symbol="pathUSD",
        name="Path USD",
        decimals=18,
        addresses={
            "tempo": "0x20c0000000000000000000000000000000000000",
        },
        logo_emoji="⚡",
        is_stablecoin=True,
    ),
    "ALPHAUSD": TokenConfig(
        symbol="AlphaUSD",
        name="Alpha USD",
        decimals=18,
        addresses={
            "tempo": "0x20c0000000000000000000000000000000000001",
        },
        logo_emoji="🅰️",
        is_stablecoin=True,
    ),
    "BETAUSD": TokenConfig(
        symbol="BetaUSD",
        name="Beta USD",
        decimals=18,
        addresses={
            "tempo": "0x20c0000000000000000000000000000000000002",
        },
        logo_emoji="🅱️",
        is_stablecoin=True,
    ),
    "THETAUSD": TokenConfig(
        symbol="ThetaUSD",
        name="Theta USD",
        decimals=18,
        addresses={
            "tempo": "0x20c0000000000000000000000000000000000003",
        },
        logo_emoji="🔷",
        is_stablecoin=True,
    ),
    # === Major Tokens (Non-Stablecoins) ===
    "WETH": TokenConfig(
        symbol="WETH",
        name="Wrapped Ether",
        decimals=18,
        addresses={
            "ethereum": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
            "bsc": "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
            "polygon": "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
            "arbitrum": "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
            "optimism": "0x4200000000000000000000000000000000000006",
            "base": "0x4200000000000000000000000000000000000006",
            "goat": "0x3a1293Bdb83bBbDd5Ebf4fAc96605aD2021BbC0f",  # bridged WETH, 18 decimals
        },
        logo_emoji="🔷",
        is_stablecoin=False,
    ),
    "WGBTC": TokenConfig(
        symbol="WGBTC",
        name="Wrapped GOAT Bitcoin",
        # GOAT's native gas token is BTC with 18 decimals (ETH-style native units,
        # unlike the 8-decimal WBTC ERC20 on other chains). WGBTC wraps that native
        # BTC 1:1, so it is ALSO 18 decimals.
        decimals=18,
        addresses={
            "goat": "0xbC10000000000000000000000000000000000000",
        },
        logo_emoji="🐐",
        is_stablecoin=False,
    ),
    "BTC": TokenConfig(
        symbol="BTC",
        name="Bitcoin (GOAT native)",
        decimals=18,  # native BTC on GOAT uses 18 decimals, like ETH
        addresses={
            "goat": "0x0000000000000000000000000000000000000000",  # native placeholder
        },
        logo_emoji="₿",
        is_stablecoin=False,
    ),
    "ETH": TokenConfig(
        symbol="ETH",
        name="Ethereum",
        decimals=18,
        addresses={
            "ethereum": "0x0000000000000000000000000000000000000000",
            "arbitrum": "0x0000000000000000000000000000000000000000",
            "optimism": "0x0000000000000000000000000000000000000000",
            "base": "0x0000000000000000000000000000000000000000",
            "solana": "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs",
            "starknet": starknet_addresses.ETH,
        },
        logo_emoji="⟠",
        is_stablecoin=False,
    ),
    "WBTC": TokenConfig(
        symbol="WBTC",
        name="Wrapped Bitcoin",
        decimals=8,
        addresses={
            "ethereum": "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
            "bsc": "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
            "polygon": "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6",
            "arbitrum": "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
            "optimism": "0x68f180fcCe6836688e9084f035309E29Bf0A2095",
            "base": "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
            "starknet": starknet_addresses.WBTC,
        },
        logo_emoji="₿",
        is_stablecoin=False,
    ),
    "BNB": TokenConfig(
        symbol="BNB",
        name="BNB",
        decimals=18,
        addresses={
            "bsc": "0x0000000000000000000000000000000000000000",
            "ethereum": "0xB8c77482e45F1F44dE1745F52C74426C631bDD52",
            "polygon": "0x3BA4c387f786bFEE076A58914F5Bd38d668B42c3",
        },
        logo_emoji="🟡",
        is_stablecoin=False,
    ),
    "WBNB": TokenConfig(
        symbol="WBNB",
        name="Wrapped BNB",
        decimals=18,
        addresses={
            "bsc": "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
        },
        logo_emoji="🟡",
        is_stablecoin=False,
    ),
    "MATIC": TokenConfig(
        symbol="MATIC",
        name="Polygon",
        decimals=18,
        addresses={
            "polygon": "0x0000000000000000000000000000000000001010",
            "ethereum": "0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0",
            "bsc": "0xCC42724C6683B7E57334c4E856f4c9965ED682bD",
        },
        logo_emoji="🟣",
        is_stablecoin=False,
    ),
    "WMATIC": TokenConfig(
        symbol="WMATIC",
        name="Wrapped MATIC",
        decimals=18,
        addresses={
            "polygon": "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
        },
        logo_emoji="🟣",
        is_stablecoin=False,
    ),
    "SOL": TokenConfig(
        symbol="SOL",
        name="Solana",
        decimals=9,
        addresses={
            "solana": "So11111111111111111111111111111111111111112",
            "ethereum": "0xD31a59c85aE9D8edEFeC411D448f90841571b89c",
        },
        logo_emoji="🟢",
        is_stablecoin=False,
    ),
    "TRX": TokenConfig(
        symbol="TRX",
        name="TRON",
        decimals=6,
        addresses={
            "tron": "native",
            "ethereum": "0x50327c6c5a14DCaDE707ABad2E27eB517df87AB5",
            "bsc": "0xCE7de646e7208a4Ef112cb6ed5038FA6cC6b12e3",
        },
        logo_emoji="💎",
        is_stablecoin=False,
    ),
    "ARB": TokenConfig(
        symbol="ARB",
        name="Arbitrum",
        decimals=18,
        addresses={
            "arbitrum": "0x912CE59144191C1204E64559FE8253a0e49E6548",
            "ethereum": "0xB50721BCf8d664c30412Cfbc6cf7a15145234ad1",
        },
        logo_emoji="🔵",
        is_stablecoin=False,
    ),
    "OP": TokenConfig(
        symbol="OP",
        name="Optimism",
        decimals=18,
        addresses={
            "optimism": "0x4200000000000000000000000000000000000042",
            "ethereum": "0x4200000000000000000000000000000000000042",
        },
        logo_emoji="🔴",
        is_stablecoin=False,
    ),
    "LINK": TokenConfig(
        symbol="LINK",
        name="Chainlink",
        decimals=18,
        addresses={
            "ethereum": "0x514910771AF9Ca656af840dff83E8264EcF986CA",
            "bsc": "0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD",
            "polygon": "0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39",
            "arbitrum": "0xf97f4df75117a78c1A5a0DBb814Af92458539FB4",
            "optimism": "0x350a791Bfc2C21F9Ed5d10980Dad2e2638ffa7f6",
            "base": "0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196",
        },
        logo_emoji="🔗",
        is_stablecoin=False,
    ),
    "UNI": TokenConfig(
        symbol="UNI",
        name="Uniswap",
        decimals=18,
        addresses={
            "ethereum": "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
            "bsc": "0xBf5140A22578168FD562DCcF235E5D43A02ce9B1",
            "polygon": "0xb33EaAd8d922B1083446DC23f610c2567fB5180f",
            "arbitrum": "0xFa7F8980b0f1E64A2062791cc3b0871572f1F7f0",
            "optimism": "0x6fd9d7AD17242c41f7131d257212c54A0e816691",
        },
        logo_emoji="🦄",
        is_stablecoin=False,
    ),
    "AAVE": TokenConfig(
        symbol="AAVE",
        name="Aave",
        decimals=18,
        addresses={
            "ethereum": "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9",
            "polygon": "0xD6DF932A45C0f255f85145f286eA0b292B21C90B",
            "arbitrum": "0xba5DdD1f9d7F570dc94a51479a000E3BCE967196",
            "optimism": "0x76FB31fb4af56892A25e32cFC43De717950c9278",
        },
        logo_emoji="👻",
        is_stablecoin=False,
    ),
    "CRV": TokenConfig(
        symbol="CRV",
        name="Curve DAO",
        decimals=18,
        addresses={
            "ethereum": "0xD533a949740bb3306d119CC777fa900bA034cd52",
            "polygon": "0x172370d5Cd63279eFa6d502DAB29171933a610AF",
            "arbitrum": "0x11cDb42B0EB46D95f990BeDD4695A6e3fA034978",
        },
        logo_emoji="🔴",
        is_stablecoin=False,
    ),
    "PEPE": TokenConfig(
        symbol="PEPE",
        name="Pepe",
        decimals=18,
        addresses={
            "ethereum": "0x6982508145454Ce325dDbE47a25d4ec3d2311933",
            "bsc": "0x25d887Ce7a35172C62FeBFD67a1856F20FaEbB00",
            "arbitrum": "0x25d887Ce7a35172C62FeBFD67a1856F20FaEbB00",
        },
        logo_emoji="🐸",
        is_stablecoin=False,
    ),
    "SHIB": TokenConfig(
        symbol="SHIB",
        name="Shiba Inu",
        decimals=18,
        addresses={
            "ethereum": "0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE",
            "bsc": "0x2859e4544C4bB03966803b044A93563Bd2D0DD4D",
        },
        logo_emoji="🐕",
        is_stablecoin=False,
    ),
    # === Liquid Staking Derivatives (LSDs) ===
    "stETH": TokenConfig(
        symbol="stETH",
        name="Lido Staked ETH",
        decimals=18,
        addresses={
            "ethereum": "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84",
        },
        logo_emoji="🔵",
        is_stablecoin=False,
    ),
    "wstETH": TokenConfig(
        symbol="wstETH",
        name="Wrapped stETH",
        decimals=18,
        addresses={
            "ethereum": "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",
            "arbitrum": "0x5979D7b546E38E414F7E9822514be443A4800529",
            "optimism": "0x1F32b1c2345538c0c6f582fCB022739c4A194Ebb",
            "base": "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452",
            "polygon": "0x03b54A6e9a984069379fae1a4fC4dBAE93B3bCCD",
            "scroll": "0xf610A9dfB7C89644979b4A0f27063E9e7d7Cda32",
            "linea": "0xB5beDd42000b71FddE22D3eE8a79Bd49A568fC8F",
            "mantle": "0x458ed78EB972a369799fb278c0243b25e5242A83",
        },
        logo_emoji="🔷",
        is_stablecoin=False,
    ),
    "rETH": TokenConfig(
        symbol="rETH",
        name="Rocket Pool ETH",
        decimals=18,
        addresses={
            "ethereum": "0xae78736Cd615f374D3085123A210448E74Fc6393",
            "arbitrum": "0xEC70Dcb4A1EFa46b8F2D97C310C9c4790ba5ffA8",
            "optimism": "0x9Bcef72be871e61ED4fBbc7630889beE758eb81D",
            "base": "0xB6fe221Fe9EeF5aBa221c348bA20A1Bf5e73624c",
            "polygon": "0x0266F4F08D82372CF0FcbCCc0Ff74309089c74d1",
            "scroll": "0x53878B874283351D26d206FA512aEcE1Bef6C0dD",
        },
        logo_emoji="🚀",
        is_stablecoin=False,
    ),
    "cbETH": TokenConfig(
        symbol="cbETH",
        name="Coinbase Wrapped Staked ETH",
        decimals=18,
        addresses={
            "ethereum": "0xBe9895146f7AF43049ca1c1AE358B0541Ea49704",
            "base": "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22",
            "arbitrum": "0x1DEBd73E752bEaF79865Fd6446b0c970EaE7732f",
            "optimism": "0xadDb6A0412DE1BA0F936DCaeb8Aaa24578dcF3B2",
            "polygon": "0x4b4327dB1600B8B1440163F667e199CEf35385f5",
        },
        logo_emoji="🪙",
        is_stablecoin=False,
    ),
    # === L2 Native Tokens ===
    "ZK": TokenConfig(
        symbol="ZK",
        name="zkSync",
        decimals=18,
        addresses={
            "ethereum": "0x5A7d6b2F92C77FAD6CCaBd7EE0624E64907Eaf3E",
        },
        logo_emoji="⚡",
        is_stablecoin=False,
    ),
    "STRK": TokenConfig(
        symbol="STRK",
        name="Starknet",
        decimals=18,
        addresses={
            "ethereum": "0xCa14007Eff0dB1f8135f4C25B34De49AB0d42766",
            "starknet": starknet_addresses.STRK,
        },
        logo_emoji="⭐",
        is_stablecoin=False,
    ),
    "MANTA": TokenConfig(
        symbol="MANTA",
        name="Manta Network",
        decimals=18,
        addresses={
            "ethereum": "0x95CeF13441Be50d20cA4558CC0a27B601aC544E5",
        },
        logo_emoji="🐋",
        is_stablecoin=False,
    ),
    # === DeFi Governance Tokens ===
    "MKR": TokenConfig(
        symbol="MKR",
        name="Maker",
        decimals=18,
        addresses={
            "ethereum": "0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2",
            "polygon": "0x6f7C932e7684666C9fd1d44527765433e01fF61d",
            "arbitrum": "0x2e9a6Df78E42a30712c10a9Dc4b1C8656f8F2879",
        },
        logo_emoji="🏛️",
        is_stablecoin=False,
    ),
    "LDO": TokenConfig(
        symbol="LDO",
        name="Lido DAO",
        decimals=18,
        addresses={
            "ethereum": "0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32",
            "arbitrum": "0x13Ad51ed4F1B7e9Dc168d8a00cB3f4dDD85EfA60",
            "optimism": "0xFdb794692724153d1488CcdBE0C56c252596735F",
            "polygon": "0xC3C7d422809852031b44ab29EEC9F1EfF2A58756",
        },
        logo_emoji="🌊",
        is_stablecoin=False,
    ),
    "SNX": TokenConfig(
        symbol="SNX",
        name="Synthetix",
        decimals=18,
        addresses={
            "ethereum": "0xC011a73ee8576Fb46F5E1c5751cA3B9Fe0af2a6F",
            "optimism": "0x8700dAec35aF8Ff88c16BdF0418774CB3D7599B4",
            "arbitrum": "0xcBA56Cd8216FCBBF3fA6DF6137F3147cBcA37D60",
            "base": "0x22e6966B799c4D5B13BE962E1D117b56327FDa66",
        },
        logo_emoji="💠",
        is_stablecoin=False,
    ),
    "COMP": TokenConfig(
        symbol="COMP",
        name="Compound",
        decimals=18,
        addresses={
            "ethereum": "0xc00e94Cb662C3520282E6f5717214004A7f26888",
            "polygon": "0x8505b9d2254A7Ae468c0E9dd10Ccea3A837aef5c",
            "arbitrum": "0x354A6dA3fcde098F8389cad84b0182725c6C91dE",
            "base": "0x9e1028F5F1D5eDE59748FFceE5532509976840E0",
        },
        logo_emoji="🟢",
        is_stablecoin=False,
    ),
    "SUSHI": TokenConfig(
        symbol="SUSHI",
        name="SushiSwap",
        decimals=18,
        addresses={
            "ethereum": "0x6B3595068778DD592e39A122f4f5a5cF09C90fE2",
            "polygon": "0x0b3F868E0BE5597D5DB7fEB59E1CADBb0fdDa50a",
            "arbitrum": "0xd4d42F0b6DEF4CE0383636770eF773390d85c61A",
            "fantom": "0xae75A438b2E0cB8Bb01Ec1E1e376De11D44477CC",
            "avalanche": "0x37B608519F91f70F2EeB0e5Ed9AF4061722e4F76",
            "gnosis": "0x2995D1317DcD4f0aB89f4AE60F3f020A4F17C7CE",
        },
        logo_emoji="🍣",
        is_stablecoin=False,
    ),
}


def get_token_address(symbol: str, chain_name: str) -> Optional[str]:
    """Get token address for a specific chain."""
    token = TOKENS.get(symbol.upper())
    if token:
        return token.addresses.get(chain_name.lower())
    return None


def get_token_by_symbol(symbol: str) -> Optional[TokenConfig]:
    """Get token configuration by symbol."""
    return TOKENS.get(symbol.upper())


def get_tokens_for_chain(chain_name: str) -> list[TokenConfig]:
    """Get all available tokens for a specific chain."""
    chain_name = chain_name.lower()
    return [token for token in TOKENS.values() if chain_name in token.addresses]


def get_token_decimals(symbol: str, chain_name: str) -> int:
    """Get token decimals. Note: Some tokens have different decimals on different chains."""
    token = TOKENS.get(symbol.upper())
    if token:
        # USDC and USDT on BSC have 18 decimals (BEP-20 standard)
        if symbol.upper() in ("USDC", "USDT") and chain_name.lower() == "bsc":
            return 18
        # GOAT Network: defensive chain-specific override (matches top-level
        # decimals today, but pinned so a future top-level change can't silently
        # corrupt GOAT amount math — mirrors the BSC override above)
        if chain_name.lower() == "goat":
            sym = symbol.upper()
            if sym in ("USDT", "USDC"):
                return 6
            if sym in ("WGBTC", "WETH"):
                return 18
        return token.decimals
    return 18  # Default


def get_decimals_by_address(address: str, chain_name: str) -> int:
    """Get token decimals by contract address and chain. Returns 18 if not found."""
    if not address:
        return 18
    addr_lower = address.lower()
    for token in TOKENS.values():
        chain_addr = token.addresses.get(chain_name.lower())
        if chain_addr and chain_addr.lower() == addr_lower:
            if token.symbol in ("USDC", "USDT") and chain_name.lower() == "bsc":
                return 18
            return token.decimals
    return 18
