const assert = require("node:assert/strict");

const { digestJson, digestJsonLegacy } = require("./integrity");

const original = {
  name: "CHIP CHOP",
  lifecycle: { status: "active", archivedAt: null },
  registrations: [{ id: "reg_1", members: [{ name: "A" }, { name: "B" }] }],
};
const reordered = {
  registrations: [{ members: [{ name: "A" }, { name: "B" }], id: "reg_1" }],
  lifecycle: { archivedAt: null, status: "active" },
  name: "CHIP CHOP",
};

assert.equal(digestJson(original), digestJson(reordered), "Canonical backup digests must ignore JSON object-key order");
assert.notEqual(digestJsonLegacy(original), digestJsonLegacy(reordered), "The regression fixture must expose the old order-sensitive digest");
assert.notEqual(digestJson(original), digestJson({ ...reordered, name: "Changed" }), "A changed value must still invalidate the backup");
assert.notEqual(digestJson(["A", "B"]), digestJson(["B", "A"]), "Array order remains meaningful");

console.log("Canonical backup integrity tests passed");
