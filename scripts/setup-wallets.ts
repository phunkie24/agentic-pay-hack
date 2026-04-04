// scripts/setup-wallets.ts
// Generates BRC-100 compliant private keys for all 5 agents
// Run ONCE before first deployment: npm run setup:wallets

import { PrivateKey } from '@bsv/sdk';
import * as fs from 'fs';
import * as path from 'path';

const AGENTS = [
  'ORCHESTRATOR',
  'DISCOVERY',
  'NEGOTIATION',
  'PAYMENT',
  'KNOWLEDGE',
  'VALIDATOR',
];

async function setupWallets(): Promise<void> {
  console.log('\n🔐 Agentic Pay — Wallet Setup\n');
  console.log('Generating BRC-100 compliant private keys for all agents...\n');

  const envLines: string[] = ['# Auto-generated agent wallet keys — keep secret!', ''];
  const summary: Array<{ agent: string; privateKey: string; publicKey: string }> = [];

  for (const agent of AGENTS) {
    const privateKey = PrivateKey.fromRandom();
    const publicKey = privateKey.toPublicKey();
    const privKeyHex = privateKey.toHex();
    const pubKeyHex = publicKey.toString();

    envLines.push(`${agent}_PRIVATE_KEY=${privKeyHex}`);
    summary.push({ agent, privateKey: privKeyHex, publicKey: pubKeyHex });

    console.log(`✅ ${agent.padEnd(15)} pubkey: ${pubKeyHex.slice(0, 20)}...`);
  }

  // Write to .env.wallets (not committed to git)
  const envPath = path.join(process.cwd(), '.env.wallets');
  fs.writeFileSync(envPath, envLines.join('\n') + '\n');
  console.log(`\n✅ Keys written to .env.wallets`);

  // Write public keys summary (safe to commit)
  const summaryPath = path.join(process.cwd(), 'wallets', 'agents.json');
  const publicSummary = summary.map(({ agent, publicKey }) => ({ agent, publicKey }));
  fs.writeFileSync(summaryPath, JSON.stringify(publicSummary, null, 2));
  console.log(`✅ Public keys written to wallets/agents.json`);

  console.log('\n⚠️  Next steps:');
  console.log('  1. Copy .env.wallets contents into your .env file');
  console.log('  2. Fund your PAYMENT agent wallet with testnet BSV:');
  console.log('     https://testnet.satoshisvision.network/ (BSV testnet faucet)');
  console.log('  3. Run: npm run fund:testnet');
  console.log('\n🚀 Ready to run: npm run dev\n');
}

setupWallets().catch(console.error);
