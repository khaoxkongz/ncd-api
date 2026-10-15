const { createHash } = require("node:crypto");

const VERSION = "expense-v1";
const ZERO = Object.freeze({ coefficient: "0", scale: 0 });
// A finite Decimal128 has at most 6145 integer digits and scale 6176.
// Exact sums of up to MAX_SAFE_INTEGER rows can add at most 16 integer
// digits. Mixed scales need both ranges; no finite-precision subtotal is used.
const MAX_SCALE = 6176;
const MAX_INTEGER_DIGITS = 6145 + String(Number.MAX_SAFE_INTEGER).length;
const MAX_DIGITS = MAX_INTEGER_DIGITS + MAX_SCALE;

function normalize(coefficient, scale) {
  if (coefficient === 0n) return ZERO;
  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale -= 1;
  }
  return Object.freeze({ coefficient: coefficient.toString(), scale });
}

function fromText(text) {
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!match) throw new Error("Unsupported or non-finite expense operand");
  const fraction = match[3] ?? "";
  const exponent = BigInt(match[4] ?? "0");
  let scale = BigInt(fraction.length) - exponent;
  if (scale > BigInt(MAX_SCALE) || scale < -BigInt(MAX_INTEGER_DIGITS))
    throw new Error("Expense exponent exceeds BSON bounds");
  let coefficient = BigInt(`${match[1]}${match[2]}${fraction}`);
  if (scale < 0n) {
    coefficient *= 10n ** -scale;
    scale = 0n;
  }
  if (coefficient.toString().replace("-", "").length > MAX_DIGITS)
    throw new Error("Expense coefficient exceeds BSON bounds");
  return normalize(coefficient, Number(scale));
}

function fromOperand(value) {
  if (typeof value === "number" || value?._bsontype === "Double") {
    const number = typeof value === "number" ? value : value.valueOf();
    if (!Number.isFinite(number)) throw new Error("Unsupported or non-finite expense operand");
    return fromText(number.toString());
  }
  if (["Int32", "Long", "Decimal128"].includes(value?._bsontype)) return fromText(value.toString());
  throw new Error("Unsupported or non-finite expense operand");
}

function checked(value) {
  if (
    !value ||
    typeof value.coefficient !== "string" ||
    !/^-?(?:0|[1-9]\d*)$/.test(value.coefficient) ||
    value.coefficient.replace("-", "").length > MAX_DIGITS ||
    !Number.isSafeInteger(value.scale) ||
    value.scale < 0 ||
    value.scale > MAX_SCALE
  )
    throw new Error("Invalid exact expense fact");
  const result = normalize(BigInt(value.coefficient), value.scale);
  if (result.coefficient !== value.coefficient || result.scale !== value.scale)
    throw new Error("Noncanonical exact expense fact");
  return result;
}

function add(left, right) {
  left = checked(left);
  right = checked(right);
  const scale = Math.max(left.scale, right.scale);
  return normalize(
    BigInt(left.coefficient) * 10n ** BigInt(scale - left.scale) +
      BigInt(right.coefficient) * 10n ** BigInt(scale - right.scale),
    scale
  );
}

function checksum(rowId, operands) {
  return createHash("sha256")
    .update(JSON.stringify([VERSION, rowId, operands.map(({ coefficient, scale }) => [coefficient, scale])]))
    .digest("hex");
}

function roundedNumber(value, denominator = 1) {
  value = checked(value);
  if (!Number.isSafeInteger(denominator) || denominator <= 0) throw new Error("Invalid expense denominator");
  const coefficient = BigInt(value.coefficient);
  const divisor = 10n ** BigInt(value.scale) * BigInt(denominator);
  const scaled = (coefficient < 0n ? -coefficient : coefficient) * 100n;
  let cents = scaled / divisor;
  if ((scaled % divisor) * 2n >= divisor) cents += 1n;
  if (coefficient < 0n) cents = -cents;
  const absolute = (cents < 0n ? -cents : cents).toString().padStart(3, "0");
  const text = `${cents < 0n ? "-" : ""}${absolute.slice(0, -2)}.${absolute.slice(-2)}`;
  const number = Number(text);
  if (!Number.isFinite(number)) throw new Error("Unsafe numeric expense serialization");
  const serialized = fromText(JSON.parse(JSON.stringify(number)).toString());
  const serializedCents = BigInt(serialized.coefficient) * 100n;
  const scale = 10n ** BigInt(serialized.scale);
  if (serializedCents % scale !== 0n || serializedCents / scale !== cents)
    throw new Error("Unsafe numeric expense serialization");
  return number === 0 ? 0 : number;
}

module.exports = { VERSION, ZERO, fromOperand, checked, add, checksum, roundedNumber };
