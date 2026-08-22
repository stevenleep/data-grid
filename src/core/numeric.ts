interface NormalizedDecimal {
  sign: -1 | 0 | 1;
  /** Significant digits without leading or trailing zeroes. */
  digits: string;
  /** Position of the decimal point relative to the first significant digit. */
  magnitude: number;
}

function numericSource(value: unknown): string | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : undefined;
  if (typeof value === 'string') return value.trim() || undefined;
  if (value && typeof value === 'object' && 'amount' in value) {
    return numericSource((value as { amount: unknown }).amount);
  }
  return undefined;
}

function normalizeDecimal(value: unknown): NormalizedDecimal | undefined {
  const source = numericSource(value);
  if (!source) return undefined;
  const match = /^([+-])?(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(source);
  if (!match) return undefined;

  const exponent = match[5] ? Number(match[5]) : 0;
  if (!Number.isSafeInteger(exponent)) return undefined;
  const integer = match[2] || '';
  const fraction = match[3] ?? match[4] ?? '';
  const rawDigits = `${integer}${fraction}`;
  const leadingZeroes = rawDigits.match(/^0*/)?.[0].length || 0;
  if (leadingZeroes === rawDigits.length) return { sign: 0, digits: '', magnitude: 0 };

  const significant = rawDigits.slice(leadingZeroes).replace(/0+$/, '');
  const magnitude = integer.length + exponent - leadingZeroes;
  if (!Number.isSafeInteger(magnitude)) return undefined;
  return {
    sign: match[1] === '-' ? -1 : 1,
    digits: significant,
    magnitude,
  };
}

function comparePositive(left: NormalizedDecimal, right: NormalizedDecimal): number {
  if (left.magnitude !== right.magnitude) return left.magnitude < right.magnitude ? -1 : 1;
  const length = Math.max(left.digits.length, right.digits.length);
  const leftDigits = left.digits.padEnd(length, '0');
  const rightDigits = right.digits.padEnd(length, '0');
  if (leftDigits === rightDigits) return 0;
  return leftDigits < rightDigits ? -1 : 1;
}

/**
 * Compares JSON-safe decimal representations without converting them to IEEE-754 numbers.
 * Money-like objects are supported through their `amount` property. `undefined` means that
 * at least one operand is not a decimal representation.
 */
export function compareExactNumeric(left: unknown, right: unknown): number | undefined {
  const normalizedLeft = normalizeDecimal(left);
  const normalizedRight = normalizeDecimal(right);
  if (!normalizedLeft || !normalizedRight) return undefined;
  if (normalizedLeft.sign !== normalizedRight.sign) {
    return normalizedLeft.sign < normalizedRight.sign ? -1 : 1;
  }
  if (normalizedLeft.sign === 0) return 0;
  const result = comparePositive(normalizedLeft, normalizedRight);
  return normalizedLeft.sign === -1 ? -result : result;
}
