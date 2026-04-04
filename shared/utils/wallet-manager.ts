// shared/utils/wallet-manager.ts
// BRC-100 compliant wallet per agent using @bsv/sdk ProtoWallet

import { ProtoWallet, PrivateKey } from '@bsv/sdk';
import type { AgentRole } from '../types';
import { logger } from './index';

const ENV_KEY_MAP: Record<AgentRole, string> = {
  orchestrator: 'ORCHESTRATOR_PRIVATE_KEY',
  discovery:    'DISCOVERY_PRIVATE_KEY',
  negotiation:  'NEGOTIATION_PRIVATE_KEY',
  payment:      'PAYMENT_PRIVATE_KEY',
  knowledge:    'KNOWLEDGE_PRIVATE_KEY',
  validator:    'VALIDATOR_PRIVATE_KEY',
};

export class AgentWallet {
  private client: ProtoWallet;
  public readonly role: AgentRole;
  public identityKey: string = '';

  constructor(role: AgentRole) {
    this.role = role;
    const envKey = ENV_KEY_MAP[role];
    const privKeyHex = process.env[envKey];
    if (!privKeyHex) throw new Error(`Missing env var: ${envKey}`);

    const privateKey = PrivateKey.fromString(privKeyHex, 'hex');
    this.client = new ProtoWallet(privateKey);
  }

  async init(): Promise<void> {
    const pubKey = await this.client.getPublicKey({ identityKey: true });
    this.identityKey = pubKey.publicKey;
    logger.info(this.role, `Wallet initialised`, { identityKey: this.identityKey });
  }

  async getBalance(): Promise<number> {
    // ProtoWallet is a signing-only wallet — balance requires an indexer
    return 0;
  }

  async createAndSendPayment(
    toIdentityKey: string,
    satoshis: number,
    metadata: Record<string, string> = {}
  ): Promise<{ txid: string; beefHex: string }> {
    // Signing stub — full broadcast requires ARC/overlay integration
    logger.info(this.role, 'Payment stub', { toIdentityKey, satoshis, metadata });
    return { txid: `stub-${Date.now()}`, beefHex: '' };
  }

  async batchPayments(
    recipients: Array<{ identityKey: string; satoshis: number; metadata?: Record<string, string> }>,
  ): Promise<{ txid: string; count: number }[]> {
    logger.info(this.role, 'Batch payment stub', { count: recipients.length });
    return [{ txid: `stub-batch-${Date.now()}`, count: recipients.length }];
  }

  getClient(): ProtoWallet {
    return this.client;
  }
}
