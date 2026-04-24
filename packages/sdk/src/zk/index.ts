import { poseidonHash } from './poseidon';
import type { CommitmentParams } from '../types';

export async function computeCommitment(params: CommitmentParams): Promise<string> {
  const {
    instrument,
    version,
    amount,
    target,
    nonce,
    paramsHash = '0',
  } = params;

  const inputs: bigint[] = [
    BigInt(instrument),
    BigInt(version),
    BigInt(amount),
    BigInt(target),
    BigInt(nonce),
    BigInt(paramsHash),
  ];

  return poseidonHash(inputs);
}

export async function computeNullifier(nonce: string, spendingKey: string): Promise<string> {
  const inputs: bigint[] = [BigInt(nonce), BigInt(spendingKey)];
  return poseidonHash(inputs);
}

export async function generateProof(_circuitName: string, _inputs: Record<string, unknown>): Promise<{ proof: unknown; publicSignals: string[] }> {
  throw new Error('generateProof requires circuit WASM and proving key files — not available in unit test mode');
}

export { poseidonHash } from './poseidon';
