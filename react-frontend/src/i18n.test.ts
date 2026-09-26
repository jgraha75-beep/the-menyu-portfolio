import { describe, expect, it } from "vitest";
import { en, ja } from "./i18n";

describe("translation catalog", () => {
  it("keeps English and Japanese keys aligned", () => {
    expect(Object.keys(ja).sort()).toEqual(Object.keys(en).sort());
  });
});
