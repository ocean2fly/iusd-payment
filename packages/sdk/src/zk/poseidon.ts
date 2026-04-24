let poseidonInstance: any = null;

export async function getPoseidon(): Promise<any> {
  if (poseidonInstance) return poseidonInstance;
  const { buildPoseidon } = await import('circomlibjs');
  poseidonInstance = await buildPoseidon();
  return poseidonInstance;
}

export async function poseidonHash(inputs: bigint[]): Promise<string> {
  const poseidon = await getPoseidon();
  const hash = poseidon(inputs.map((i) => poseidon.F.e(i)));
  const result = poseidon.F.toString(hash);
  return '0x' + BigInt(result).toString(16).padStart(64, '0');
}
