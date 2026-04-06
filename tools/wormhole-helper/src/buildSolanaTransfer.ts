import { CONFIG, UniversalAddress } from '@wormhole-foundation/sdk';
import { SolanaTokenBridge } from '@wormhole-foundation/sdk-solana-tokenbridge';
import { Connection, Keypair, Transaction } from '@solana/web3.js';

type Input = {
  sender: string;
  token: string;
  amount: string;
  destinationChain: string;
  destinationAddress: string;
  rpcUrl?: string;
};

function readInput(): Promise<Input> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(error);
      }
    });
    process.stdin.on('error', reject);
  });
}

async function main() {
  const input = await readInput();
  const config = CONFIG.Mainnet.chains.Solana;
  const connection = new Connection(input.rpcUrl || config.rpc, 'confirmed');
  const tokenBridge = new SolanaTokenBridge('Mainnet', 'Solana', connection, config.contracts);

  const recipient = {
    chain: input.destinationChain as never,
    address: new UniversalAddress(input.destinationAddress),
  };

  const txIter = tokenBridge.transfer(
    input.sender,
    recipient,
    input.token,
    BigInt(input.amount),
  );

  const first = await txIter.next();
  if (first.done || !first.value) {
    throw new Error('Wormhole SDK did not produce a transfer transaction');
  }

  const unsigned = first.value.transaction as { transaction: Transaction; signers?: Keypair[] };
  const tx = unsigned.transaction;
  const blockhash = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash.blockhash;

  for (const signer of unsigned.signers || []) {
    tx.partialSign(signer);
  }

  process.stdout.write(JSON.stringify({
    unsignedTxBase64: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64'),
    description: first.value.description,
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
