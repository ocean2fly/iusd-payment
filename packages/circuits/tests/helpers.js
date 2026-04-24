const path = require("path");
const snarkjs = require("snarkjs");
const { buildPoseidon } = require("circomlibjs");

const BUILD_DIR = path.join(__dirname, "..", "build");
const KEYS_DIR = path.join(__dirname, "..", "keys");

let poseidonInstance = null;

async function getPoseidon() {
  if (!poseidonInstance) {
    poseidonInstance = await buildPoseidon();
  }
  return poseidonInstance;
}

function poseidonHash(poseidon, inputs) {
  const hash = poseidon(inputs.map((x) => BigInt(x)));
  return poseidon.F.toObject(hash);
}

function getWasmPath(circuitName) {
  return path.join(BUILD_DIR, `${circuitName}_js`, `${circuitName}.wasm`);
}

function getZkeyPath(circuitName) {
  return path.join(KEYS_DIR, `${circuitName}_final.zkey`);
}

function getVkeyPath(circuitName) {
  return path.join(KEYS_DIR, `${circuitName}_vkey.json`);
}

async function calculateWitness(circuitName, input) {
  const wasmPath = getWasmPath(circuitName);
  const wtns = { type: "mem" };
  await snarkjs.wtns.calculate(input, wasmPath, wtns);
  return wtns;
}

async function fullProve(circuitName, input) {
  const wasmPath = getWasmPath(circuitName);
  const zkeyPath = getZkeyPath(circuitName);
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    wasmPath,
    zkeyPath
  );
  return { proof, publicSignals };
}

async function verify(circuitName, proof, publicSignals) {
  const vkeyPath = getVkeyPath(circuitName);
  const vkey = require(vkeyPath);
  return snarkjs.groth16.verify(vkey, publicSignals, proof);
}

// Build a depth-20 Merkle tree with a single leaf and return root + path
async function buildMerkleTree(poseidon, leaf, leafIndex = 0) {
  const depth = 20;
  const F = poseidon.F;

  // Zero values for each level
  const zeros = [BigInt(0)];
  for (let i = 1; i <= depth; i++) {
    const h = poseidon([zeros[i - 1], zeros[i - 1]]);
    zeros.push(F.toObject(h));
  }

  // Insert leaf at leafIndex
  let currentHash = leaf;
  const pathElements = [];
  const pathIndices = [];

  for (let i = 0; i < depth; i++) {
    const bit = (leafIndex >> i) & 1;
    pathIndices.push(bit);
    pathElements.push(zeros[i]); // sibling is always zero for single-leaf tree

    let left, right;
    if (bit === 0) {
      left = currentHash;
      right = zeros[i];
    } else {
      left = zeros[i];
      right = currentHash;
    }

    const h = poseidon([left, right]);
    currentHash = F.toObject(h);
  }

  return {
    root: currentHash,
    pathElements,
    pathIndices,
  };
}

// Random field element (252-bit)
function randomFieldElement() {
  // BN254 field: p ≈ 2^254, we use 252 bits to be safe
  let hex = "0x";
  for (let i = 0; i < 63; i++) {
    hex += Math.floor(Math.random() * 16).toString(16);
  }
  // Ensure first nibble is small to stay within field
  hex = "0x0" + hex.slice(3);
  return BigInt(hex);
}

module.exports = {
  getPoseidon,
  poseidonHash,
  calculateWitness,
  fullProve,
  verify,
  buildMerkleTree,
  randomFieldElement,
  BUILD_DIR,
  KEYS_DIR,
};
