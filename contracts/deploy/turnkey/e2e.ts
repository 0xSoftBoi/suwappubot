/**
 * Live end-to-end smoke test for a deployed CommonsClearingHouse.
 *
 * Three throwaway in-memory keys (A, B, C) act only through EIP-712 signed
 * intents; the Turnkey deployer relays everything (the chat-bot/relayer model)
 * and runs clear() on their debt cycle. Exercises: terms-bound accept, pay,
 * multilateral clear, pull-based settle, withdraw.
 *
 *   TURNKEY_SIGN_WITH=0x… CLEARING_HOUSE=0x… bun --env-file=… run e2e.ts
 */
import { Turnkey } from "@turnkey/sdk-server";
import { createAccount } from "@turnkey/viem";
import {
	createPublicClient,
	createWalletClient,
	encodeAbiParameters,
	formatEther,
	http,
	keccak256,
	parseAbi,
	parseEther,
	type Account,
	type Address,
	type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const RPC = "https://sepolia.base.org";
const CH = process.env.CLEARING_HOUSE as Address;
const MUSD = "0x75b2D073101f79f4A2289EF8312D5c7eD2524BD8" as Address; // test MockUSD, public mint
if (!CH) throw new Error("set CLEARING_HOUSE");

const abi = parseAbi([
	"struct Intent { address signer; uint8 action; bytes params; uint256 nonce; uint256 deadline; }",
	"struct Edge { address debtor; address creditor; uint256 amount; }",
	"function execute(Intent it, bytes signature) returns (bytes)",
	"function clear(address token, Edge[] edges) returns (uint256)",
	"function owedBy(address debtor, address creditor, address token) view returns (uint256)",
	"function claimable(address creditor, address token) view returns (uint256)",
	"function getLine(address x, address y, address token) view returns ((uint128 limitLo, uint128 limitHi, int256 balance, uint64 feeRate, uint64 grace, uint64 lastAccrual, uint64 demandTs, address demandBy, uint8 status, uint8 flags, uint32 nonce, address proposer, bytes32 termsHash))",
]);
const erc20 = parseAbi([
	"function mint(address to, uint256 amount)",
	"function approve(address spender, uint256 amount) returns (bool)",
	"function balanceOf(address) view returns (uint256)",
]);

enum Action {
	Propose = 0,
	Accept = 1,
	Pay = 6,
	Settle = 8,
	Demand = 9,
	Withdraw = 13,
}

const pub = createPublicClient({ chain: baseSepolia, transport: http(RPC) });
// Testnet relaying uses a LOCAL key (RELAYER_PRIVATE_KEY). The Turnkey org is
// production's (python-api WALLET_PROVIDER=turnkey) and quota-limited — testnet
// signing there exhausted it on 2026-11-06. Turnkey stays only as an explicit opt-in.
async function makeRelayer(): Promise<Account> {
	const pk = process.env.RELAYER_PRIVATE_KEY as Hex | undefined;
	if (pk) return privateKeyToAccount(pk);
	if (process.env.ALLOW_PROD_TURNKEY !== "1") {
		throw new Error(
			"set RELAYER_PRIVATE_KEY (local testnet key). Turnkey is production's org; opt in with ALLOW_PROD_TURNKEY=1 only if you mean it.",
		);
	}
	const tk = new Turnkey({
		apiBaseUrl: process.env.TURNKEY_BASE_URL ?? "https://api.turnkey.com",
		apiPublicKey: process.env.TURNKEY_API_PUBLIC_KEY!,
		apiPrivateKey: process.env.TURNKEY_API_PRIVATE_KEY!,
		defaultOrganizationId: process.env.TURNKEY_ORGANIZATION_ID!,
	});
	return (await createAccount({
		client: tk.apiClient(),
		organizationId: process.env.TURNKEY_ORGANIZATION_ID!,
		signWith: process.env.TURNKEY_SIGN_WITH!,
	})) as Account;
}
const relayerAccount = await makeRelayer();
const relayer = createWalletClient({ account: relayerAccount, chain: baseSepolia, transport: http(RPC) });

let nonceSeq = BigInt(Date.now());
const e18 = (n: number) => parseEther(String(n));

async function send(label: string, p: Promise<Hex>) {
	const hash = await p;
	const r = await pub.waitForTransactionReceipt({ hash });
	if (r.status !== "success") throw new Error(`${label} reverted: ${hash}`);
	console.log(`  ✓ ${label.padEnd(34)} ${hash}`);
	return r;
}

async function intent(who: PrivateKeyAccount, action: Action, types: string, values: unknown[], label: string) {
	const params = encodeAbiParameters(
		types.split(",").map((t) => ({ type: t.trim() })),
		values as never,
	);
	const it = {
		signer: who.address,
		action,
		params,
		nonce: nonceSeq++,
		deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
	};
	const signature = await who.signTypedData({
		domain: { name: "CommonsClearingHouse", version: "1", chainId: baseSepolia.id, verifyingContract: CH },
		types: {
			Intent: [
				{ name: "signer", type: "address" },
				{ name: "action", type: "uint8" },
				{ name: "paramsHash", type: "bytes32" },
				{ name: "nonce", type: "uint256" },
				{ name: "deadline", type: "uint256" },
			],
		},
		primaryType: "Intent",
		message: { signer: it.signer, action, paramsHash: keccak256(params), nonce: it.nonce, deadline: it.deadline },
	});
	// Public-RPC estimates came back low enough to OOG an accept (gasUsed ==
	// gasLimit), so estimate explicitly and send with a 50% buffer.
	const est = await pub.estimateContractGas({
		account: relayerAccount,
		address: CH,
		abi,
		functionName: "execute",
		args: [it, signature],
	});
	const r = await send(
		label,
		relayer.writeContract({ address: CH, abi, functionName: "execute", args: [it, signature], gas: (est * 3n) / 2n }),
	);
	console.log(`      gas est ${est} · used ${r.gasUsed}`);
	return r;
}

/** x proposes (extending 0), y accepts extending `lim` — so x may owe y up to lim. */
async function openLine(x: PrivateKeyAccount, y: PrivateKeyAccount, lim: bigint, name: string) {
	await intent(x, Action.Propose, "address,address,uint256,uint256,uint64,uint8", [y.address, MUSD, 0n, 0n, 86400n, 1], `${name} propose (signed)`);
	const line = await pub.readContract({ address: CH, abi, functionName: "getLine", args: [x.address, y.address, MUSD] });
	await intent(y, Action.Accept, "address,address,uint256,bytes32", [x.address, MUSD, lim, line.termsHash], `${name} accept w/ termsHash`);
}

const owed = (d: Address, c: Address) => pub.readContract({ address: CH, abi, functionName: "owedBy", args: [d, c, MUSD] });
function expect(label: string, got: bigint, want: bigint) {
	if (got !== want) throw new Error(`${label}: got ${formatEther(got)}, want ${formatEther(want)}`);
	console.log(`  ✓ ${label} = ${formatEther(got)}`);
}

const [A, B, C] = [0, 1, 2].map(() => privateKeyToAccount(generatePrivateKey()));
console.log(`relayer ${relayerAccount.address} · clearing house ${CH}`);
console.log(`A ${A.address}\nB ${B.address}\nC ${C.address}\n`);

console.log("1. open a triangle of lines via signed intents");
await openLine(A, B, e18(100), "A-B");
await openLine(B, C, e18(100), "B-C");
await openLine(C, A, e18(100), "C-A");

console.log("2. pay around the triangle (signed)");
await intent(A, Action.Pay, "address,address,uint256", [B.address, MUSD, e18(30)], "A pays B 30 on credit");
await intent(B, Action.Pay, "address,address,uint256", [C.address, MUSD, e18(50)], "B pays C 50 on credit");
await intent(C, Action.Pay, "address,address,uint256", [A.address, MUSD, e18(20)], "C pays A 20 on credit");

if (process.env.E2E_SEED_DESK === "1") {
	// Desk workflow fixtures for A: a demand against A, and an incoming proposal.
	console.log("2b. seed desk workflow states for A");
	await intent(B, Action.Demand, "address,address", [A.address, MUSD], "B demands A settle (grace 1d)");
	const D = privateKeyToAccount(generatePrivateKey());
	await intent(D, Action.Propose, "address,address,uint256,uint256,uint64,uint8", [A.address, MUSD, e18(50), 1585489599n, 172800n, 1], "D proposes 50 @5% to A");
	console.log(`\nSEEDED desk for A: ${A.address}\nB ${B.address}\nC ${C.address}\nD ${D.address}`);
	process.exit(0);
}

if (process.env.E2E_SEED_ONLY === "1") {
	// Leave the cycle open so the terminal's clearing desk has live work to find.
	console.log(`\nSEEDED open cycle A->B->C->A (20 clearable). Inspect as A: ${A.address}`);
	process.exit(0);
}

console.log("3. relayer clears the 20-unit cycle (nobody's net position moves)");
await send(
	"clear(A->B->C->A, 20)",
	relayer.writeContract({
		address: CH,
		abi,
		functionName: "clear",
		args: [
			MUSD,
			[
				{ debtor: A.address, creditor: B.address, amount: e18(20) },
				{ debtor: B.address, creditor: C.address, amount: e18(20) },
				{ debtor: C.address, creditor: A.address, amount: e18(20) },
			],
		],
	}),
);
expect("A owes B", await owed(A.address, B.address), e18(10));
expect("B owes C", await owed(B.address, C.address), e18(30));
expect("C owes A", await owed(C.address, A.address), 0n);

console.log("4. A settles 10 mUSD in real tokens (pull-based escrow)");
await send("mint 10 mUSD to A", relayer.writeContract({ address: MUSD, abi: erc20, functionName: "mint", args: [A.address, e18(10)] }));
await send("gas for A's approve", relayer.sendTransaction({ to: A.address, value: parseEther("0.0002") }));
const aWallet = createWalletClient({ account: A, chain: baseSepolia, transport: http(RPC) });
await send("A approves clearing house", aWallet.writeContract({ address: MUSD, abi: erc20, functionName: "approve", args: [CH, e18(10)] }));
await intent(A, Action.Settle, "address,address,uint256", [B.address, MUSD, e18(10)], "A settles B 10 (signed)");
expect("A owes B", await owed(A.address, B.address), 0n);
expect("B claimable", await pub.readContract({ address: CH, abi, functionName: "claimable", args: [B.address, MUSD] }), e18(10));

console.log("5. B withdraws (signed)");
await intent(B, Action.Withdraw, "address,address", [MUSD, B.address], "B withdraws to self");
expect("B mUSD balance", await pub.readContract({ address: MUSD, abi: erc20, functionName: "balanceOf", args: [B.address] }), e18(10));
expect("CH custody", await pub.readContract({ address: MUSD, abi: erc20, functionName: "balanceOf", args: [CH] }), 0n);

console.log("\nE2E PASSED on Base Sepolia");
