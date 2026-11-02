import { describe, expect, it } from "vitest";

import { compareVersions } from "./version";

describe("compareVersions", () => {
    it("compares numeric fix identifiers and keeps stable releases above fixes", () => {
        expect(compareVersions("v0.0.7-fix.2", "v0.0.7-fix.1")).toBeGreaterThan(0);
        expect(compareVersions("v0.0.7-fix.10", "v0.0.7-fix.2")).toBeGreaterThan(0);
        expect(compareVersions("v0.0.7", "v0.0.7-fix.2")).toBeGreaterThan(0);
        expect(compareVersions("0.0.8", "v0.0.7-fix.2")).toBeGreaterThan(0);
        expect(compareVersions("v0.0.7-fix.1", "v0.0.7-fix.2")).toBeLessThan(0);
    });

    it("returns zero for equal or invalid versions", () => {
        expect(compareVersions("v0.0.7-fix.2", "0.0.7-fix.2")).toBe(0);
        expect(compareVersions("latest", "v0.0.7-fix.2")).toBe(0);
    });
});
