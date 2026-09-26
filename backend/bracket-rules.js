const BRACKET_SIZES = Object.freeze([2, 4, 8, 16, 32]);

function validBracketSize(value) { return BRACKET_SIZES.includes(value); }

function firstPairs(participants, { seeded = true, size } = {}) {
  if (!validBracketSize(size)) throw new Error("Bracket size must be Top 2, Top 4, Top 8, Top 16, or Top 32");
  if (participants.length > size) throw new Error(`This bracket has ${participants.length} entries but only ${size} slots`);
  const padded = [...participants, ...Array(size - participants.length).fill(null)];
  if (seeded) return Array.from({ length: size / 2 }, (_, index) => [padded[index], padded[size - 1 - index]]);
  return Array.from({ length: size / 2 }, (_, index) => [padded[index * 2], padded[(index * 2) + 1]]);
}

module.exports = { BRACKET_SIZES, firstPairs, validBracketSize };
