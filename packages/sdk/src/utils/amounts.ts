const DECIMALS = 6;
const MULTIPLIER = 10 ** DECIMALS;
const MIN_AMOUNT = '0.001';

export function toBaseUnits(amount: string): string {
  const num = parseFloat(amount);
  if (isNaN(num) || num < 0) {
    throw new Error(`Invalid amount: ${amount}`);
  }

  const parts = amount.split('.');
  const decimalPlaces = parts[1]?.length ?? 0;

  if (decimalPlaces > DECIMALS) {
    throw new Error(`Amount ${amount} exceeds maximum ${DECIMALS} decimal places`);
  }

  if (num > 0 && num < parseFloat(MIN_AMOUNT)) {
    throw new Error(`Amount ${amount} is below minimum ${MIN_AMOUNT}`);
  }

  const result = Math.round(num * MULTIPLIER);
  return result.toString();
}

export function fromBaseUnits(baseUnits: string): string {
  const num = BigInt(baseUnits);
  const whole = num / BigInt(MULTIPLIER);
  const frac = num % BigInt(MULTIPLIER);

  if (frac === 0n) {
    return `${whole}.00`;
  }

  const fracStr = frac.toString().padStart(DECIMALS, '0');
  // trim trailing zeros but keep at least 2 decimal places
  let trimmed = fracStr.replace(/0+$/, '');
  if (trimmed.length < 2) {
    trimmed = fracStr.slice(0, 2);
  }

  return `${whole}.${trimmed}`;
}

export function formatAmount(baseUnits: string): string {
  const formatted = fromBaseUnits(baseUnits);
  return `${formatted} iUSD`;
}
