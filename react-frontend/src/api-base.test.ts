import { describe, expect, it } from "vitest";
import { apiBaseFor } from "./api-base";

describe("API endpoint selection", () => {
  it("uses the local backend only for local development", () => {
    expect(apiBaseFor({ hostname: "localhost", protocol: "http:", origin: "http://localhost:4175" }, "")).toBe("http://localhost:3000/api");
    expect(apiBaseFor({ hostname: "127.0.0.1", protocol: "http:", origin: "http://127.0.0.1:4175" }, "")).toBe("http://127.0.0.1:3000/api");
  });

  it("uses same-origin API routes outside local development", () => {
    expect(apiBaseFor({ hostname: "staff.themenyu.example", protocol: "https:", origin: "https://staff.themenyu.example" }, "")).toBe("https://staff.themenyu.example/api");
  });

  it("only uses a configured build-time endpoint override", () => {
    expect(apiBaseFor({ hostname: "staff.themenyu.example", protocol: "https:", origin: "https://staff.themenyu.example" }, "https://staging.themenyu.example/api/")).toBe("https://staging.themenyu.example/api");
  });
});
