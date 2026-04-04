// scripts/fund-testnet.ts
// Checks wallet balances and prints funding instructions

import { WalletClient } from '@bsv/sdk';
import * as dotenv from 'dotenv';
dotenv.config();

const AGENTS = ['ORCHESTRATOR', 'DISCOVERY', 'NEGOTIATION', 'PAYMENT', 'KNOWLEDGE', 'VALIDATOR'];

async function checkBalances(): Promise<void> {
  console.log('\n💰 Agentic Pay — Wallet Balance Check (Testnet)\n');

  for (const agent of AGENTS) {
    const privKey = process.env[`${agent}_PRIVATE_KEY`];
    if (!privKey) {
      console.log(`❌ ${agent.padEnd(15)} — no private key found`);
      continue;
    }

    try {
      const client = new WalletClient('auto', { privateKey: privKey });
      const pubKey = await client.getPublicKey({ identityKey: true });
      const balance = await client.getBalance();
      const status = balance.satoshis > 0 ? '✅' : '⚠️ ';
      console.log(
        `${status} ${agent.padEnd(15)} ${balance.satoshis.toLocaleString().padStart(12)} sats  |  key: ${pubKey.publicKey.slice(0, 16)}...`
      );
    } catch (err) {
      console.log(`❌ ${agent.padEnd(15)} — error: ${err}`);
    }
  }

  console.log('\n📋 Testnet faucets:');
  console.log('  • https://testnet.satoshisvision.network/');
  console.log('  • https://witnessonchain.com/faucet/tbsv');
  console.log('\nFund your PAYMENT agent wallet address above with at least 10,000 sats.');
  console.log('1 testnet BSV = 100,000,000 satoshis — even 0.001 BSV covers 1.5M micro-payments.\n');
}

checkBalances().catch(console.error);
