/**
 * Deploy Commons contracts with a Turnkey-held key.
 *
 * The signing key never leaves Turnkey: viem builds the tx, @turnkey/viem asks
 * Turnkey to sign it (subject to the org's policy engine), and we broadcast.
 * Use a NON-ROOT API key scoped by policy to the deployer wallet — root keys
 * bypass Turnkey policy evaluation.
 *
 * Env:
 *   TURNKEY_API_PUBLIC_KEY, TURNKEY_API_PRIVATE_KEY, TURNKEY_ORGANIZATION_ID
 *   TURNKEY_BASE_URL     (default https://api.turnkey.com)
 *   TURNKEY_SIGN_WITH    deployer address (deploy only; from `create-wallet`)
 *   COMMONS_CHAIN        base-sepolia (default) | hyperevm-testnet
 *   RPC_URL              optional override
 *
 * Usage (from contracts/):
 *   ~/.foundry/bin/forge build commons/CommonsClearingHouse.sol
 *   cd deploy/turnkey && bun install
 *   bun run deploy.ts create-wallet          # once; fund the printed address
 *   TURNKEY_SIGN_WITH=0x… bun run deploy.ts deploy
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Turnkey } from "@turnkey/sdk-server";
import { createAccount } from "@turnkey/viem";
import {
	createPublicClient,
	createWalletClient,
	formatEther,
	http,
	parseAbi,
	parseEther,
	type Account,
	type Chain,
	type Hex,
} from "viem";
import { baseSepolia, sepolia } from "viem/chains";

const here = dirname(fileURLToPath(import.meta.url));

const hyperEvmTestnet = {
	id: 998,
	name: "HyperEVM Testnet",
	nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
	rpcUrls: { default: { http: ["https://rpc.hyperliquid-testnet.xyz/evm"] } },
	testnet: true,
} as const satisfies Chain;

// Testnets only. Mainnet deploys are gated on the external audit
// (docs/plans/commons-v2.md §8) and are deliberately not wired here.
const CHAINS: Record<string, Chain> = {
	"base-sepolia": baseSepolia,
	"hyperevm-testnet": hyperEvmTestnet,
};

function env(name: string, fallback?: string): string {
	const v = process.env[name] ?? fallback;
	if (!v) throw new Error(`missing env ${name}`);
	return v;
}

function turnkey() {
	return new Turnkey({
		apiBaseUrl: env("TURNKEY_BASE_URL", "https://api.turnkey.com"),
		apiPublicKey: env("TURNKEY_API_PUBLIC_KEY"),
		apiPrivateKey: env("TURNKEY_API_PRIVATE_KEY"),
		defaultOrganizationId: env("TURNKEY_ORGANIZATION_ID"),
	});
}

async function createDeployerWallet() {
	const tk = turnkey();
	const { walletId, addresses } = await tk.apiClient().createWallet({
		walletName: `commons-deployer-${new Date().toISOString().slice(0, 10)}`,
		accounts: [
			{
				curve: "CURVE_SECP256K1",
				pathFormat: "PATH_FORMAT_BIP32",
				path: "m/44'/60'/0'/0/0",
				addressFormat: "ADDRESS_FORMAT_ETHEREUM",
			},
		],
	});
	console.log("walletId:", walletId);
	console.log("deployer address:", addresses[0]);
	console.log("Fund it with Base Sepolia ETH, then: TURNKEY_SIGN_WITH=" + addresses[0] + " bun run deploy.ts deploy");
}

async function deploy(contractName: string) {
	const chainKey = env("COMMONS_CHAIN", "base-sepolia");
	const chain = CHAINS[chainKey];
	if (!chain) throw new Error(`COMMONS_CHAIN must be one of ${Object.keys(CHAINS).join(", ")}`);
	const rpc = process.env.RPC_URL ?? chain.rpcUrls.default.http[0];

	const artifactPath = resolve(here, `../../out/${contractName}.sol/${contractName}.json`);
	const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
	const bytecode = artifact.bytecode?.object as Hex | undefined;
	if (!bytecode || bytecode === "0x") throw new Error(`no bytecode in ${artifactPath} — run forge build first`);

	const signWith = env("TURNKEY_SIGN_WITH");
	const tk = turnkey();
	const account = (await createAccount({
		client: tk.apiClient(),
		organizationId: env("TURNKEY_ORGANIZATION_ID"),
		signWith,
	})) as Account;

	const publicClient = createPublicClient({ chain, transport: http(rpc) });
	const walletClient = createWalletClient({ account, chain, transport: http(rpc) });

	const remoteChainId = await publicClient.getChainId();
	if (remoteChainId !== chain.id) throw new Error(`RPC is chain ${remoteChainId}, expected ${chain.id}`);
	const balance = await publicClient.getBalance({ address: account.address });
	console.log(`chain ${chain.name} (${chain.id}) · deployer ${account.address} · balance ${formatEther(balance)}`);
	if (balance === 0n) throw new Error("deployer has no gas — fund it first");

	const hash = await walletClient.deployContract({ abi: artifact.abi, bytecode, args: [] });
	console.log("tx:", hash);
	const receipt = await publicClient.waitForTransactionReceipt({ hash });
	if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`deploy failed: ${receipt.status}`);
	const address = receipt.contractAddress;
	const code = await publicClient.getCode({ address });
	if (!code || code === "0x") throw new Error("no code at deployed address");

	// Smoke read: the contract is live and computes its EIP-712 domain for this chain.
	const domain = await publicClient.readContract({
		address,
		abi: parseAbi(["function domainSeparator() view returns (bytes32)"]),
		functionName: "domainSeparator",
	});
	console.log(`${contractName} deployed at ${address} (block ${receipt.blockNumber})`);
	console.log("domainSeparator:", domain);

	const outDir = resolve(here, "../../deployments");
	mkdirSync(outDir, { recursive: true });
	const record = {
		contract: contractName,
		address,
		chainId: chain.id,
		txHash: hash,
		block: receipt.blockNumber.toString(),
		deployer: account.address,
		signer: "turnkey",
		deployedAt: new Date().toISOString(),
	};
	writeFileSync(resolve(outDir, `${contractName}.${chain.id}.json`), `${JSON.stringify(record, null, 2)}\n`);
	console.log(`recorded → contracts/deployments/${contractName}.${chain.id}.json`);
}

/**
 * Bridge Ethereum Sepolia ETH -> Base Sepolia for the deployer, through Base's
 * official OP Stack L1StandardBridge (verified: v2.8.0, OTHER_BRIDGE =
 * 0x4200…0010, messenger = Base Sepolia L1CrossDomainMessenger). Funds arrive
 * at the same address on Base Sepolia, typically within a few minutes.
 */
const BASE_SEPOLIA_L1_STANDARD_BRIDGE = "0xfd0Bf71F60660E2f608ed56e1659C450eB113120" as const;

async function bridgeToBaseSepolia(etherArg: string | undefined) {
	const signWith = env("TURNKEY_SIGN_WITH");
	const l1Rpc = process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
	const tk = turnkey();
	const account = (await createAccount({
		client: tk.apiClient(),
		organizationId: env("TURNKEY_ORGANIZATION_ID"),
		signWith,
	})) as Account;
	const l1 = createPublicClient({ chain: sepolia, transport: http(l1Rpc) });
	const l1Wallet = createWalletClient({ account, chain: sepolia, transport: http(l1Rpc) });
	const l2 = createPublicClient({ chain: baseSepolia, transport: http("https://sepolia.base.org") });
	if ((await l1.getChainId()) !== sepolia.id) throw new Error("L1 RPC is not Ethereum Sepolia");

	const bal = await l1.getBalance({ address: account.address });
	// Keep a little for L1 gas; bridge the rest unless an amount was given.
	const reserve = parseEther("0.003");
	const value = etherArg ? parseEther(etherArg) : bal > reserve ? bal - reserve : 0n;
	console.log(`Sepolia balance ${formatEther(bal)} · bridging ${formatEther(value)} to Base Sepolia`);
	if (value === 0n || value + reserve > bal) throw new Error("not enough Sepolia ETH to bridge (need > 0.003 for gas)");

	const l2Before = await l2.getBalance({ address: account.address });
	const hash = await l1Wallet.writeContract({
		address: BASE_SEPOLIA_L1_STANDARD_BRIDGE,
		abi: parseAbi(["function depositETH(uint32 _minGasLimit, bytes _extraData) payable"]),
		functionName: "depositETH",
		args: [200_000, "0x"],
		value,
	});
	const r = await l1.waitForTransactionReceipt({ hash });
	console.log(`L1 deposit tx ${hash} · ${r.status}`);
	if (r.status !== "success") throw new Error("deposit reverted");

	for (let i = 0; i < 40; i++) {
		await new Promise((res) => setTimeout(res, 15_000));
		const now = await l2.getBalance({ address: account.address });
		if (now > l2Before) {
			console.log(`arrived on Base Sepolia: ${formatEther(now)} ETH`);
			return;
		}
		console.log(`waiting for L2 credit… (${(i + 1) * 15}s)`);
	}
	console.log("not credited after 10 min — deposits can take longer; re-check balance later");
}

const [cmd, contract = "CommonsClearingHouse"] = process.argv.slice(2);
if (cmd === "create-wallet") await createDeployerWallet();
else if (cmd === "deploy") await deploy(contract);
else if (cmd === "bridge") await bridgeToBaseSepolia(process.argv[3]);
else {
	console.error("usage: bun run deploy.ts <create-wallet | deploy [ContractName] | bridge [ether]>");
	process.exit(1);
}
