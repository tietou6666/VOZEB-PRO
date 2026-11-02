import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";
import { bracesFixUnavailable, legacyMinimatchSourceVerified, reviewDependencyAudit } from "./dependency-audit.mjs";

const advisory = () => ({
    github_advisory_id: "GHSA-vfj7-8cjw-p6xm",
    module_name: "braces",
    severity: "high",
    patched_versions: null,
    findings: [{ version: "3.0.3", dev: true, paths: [".>eslint-config-next>fast-glob>micromatch>braces", ".>shadcn>fast-glob>micromatch>braces"] }],
});
const report = (item) => ({ advisories: { braces: item }, metadata: { vulnerabilities: { high: 1 } } });

describe("dependency audit development exception", () => {
    it("only accepts the known unpatched advisory in the existing development tools", () => {
        const item = advisory();
        expect(reviewDependencyAudit(report(item), { fixUnavailable: true })).toEqual({ accepted: [item], blocked: [] });
    });
    it.each([
        [
            "production dependency",
            (item) => {
                item.findings[0].dev = false;
            },
        ],
        [
            "new dependency path",
            (item) => {
                item.findings[0].paths.push(".>new-tool>braces");
            },
        ],
        [
            "available upstream fix",
            (item) => {
                item.patched_versions = ">=3.0.5";
            },
        ],
        [
            "different advisory",
            (item) => {
                item.github_advisory_id = "GHSA-other";
            },
        ],
        [
            "missing findings",
            (item) => {
                item.findings = [];
            },
        ],
    ])("blocks %s", (_name, change) => {
        const item = advisory();
        change(item);
        expect(reviewDependencyAudit(report(item), { fixUnavailable: true })).toEqual({ accepted: [], blocked: [item] });
    });
    it("rejects missing details for a nonempty vulnerability count", () => {
        expect(() => reviewDependencyAudit({ advisories: {}, metadata: { vulnerabilities: { high: 1 } } })).toThrow("依赖审计缺少漏洞明细");
    });
    it("rejects a registry error instead of treating it as an empty audit", () => {
        expect(() => reviewDependencyAudit({ error: "registry unavailable" })).toThrow("依赖审计响应无效");
    });
});

describe("published braces fix lookup", () => {
    it("accepts pnpm's projected range only after the registry confirms no released fix", () => {
        const item = advisory();
        item.patched_versions = ">=3.0.4";
        expect(reviewDependencyAudit(report(item), { fixUnavailable: true }).blocked).toEqual([]);
        expect(reviewDependencyAudit(report(item)).blocked).toEqual([item]);
        expect(bracesFixUnavailable({ status: 1, stdout: JSON.stringify({ error: { code: "ERR_PNPM_PACKAGE_NOT_FOUND" } }) })).toBe(true);
    });
    it("blocks the exception when any matching fixed version is published", () => {
        expect(bracesFixUnavailable({ status: 0, stdout: JSON.stringify("3.0.4") })).toBe(false);
        expect(bracesFixUnavailable({ status: 0, stdout: JSON.stringify(["3.0.5", "4.0.0"]) })).toBe(false);
        expect(reviewDependencyAudit(report(advisory()), { fixUnavailable: false }).blocked).toHaveLength(1);
    });
    it("rejects lookup network errors and empty responses", () => {
        expect(() => bracesFixUnavailable({ status: 1, stdout: JSON.stringify({ error: { code: "ECONNRESET" } }) })).toThrow("修复版本查询响应无效");
        expect(() => bracesFixUnavailable({ status: 0, stdout: "" })).toThrow();
    });
});

describe("legacy minimatch advisory source review", () => {
    const legacy = () => ({
        github_advisory_id: "GHSA-g3hv-75wg-m249",
        module_name: "minimatch",
        severity: "moderate",
        vulnerable_versions: "<11.0.1",
        patched_versions: ">=11.0.1",
        findings: [{ version: "3.1.5", dev: true, paths: [".>eslint>minimatch", ".>eslint-config-next>eslint-plugin-react>minimatch"] }],
    });
    it("verifies the exact installed source without the affected preprocessing algorithm", () => {
        const require = createRequire(import.meta.url);
        const source = readFileSync(require.resolve("minimatch", { paths: [require.resolve("eslint/package.json")] }));
        expect(legacyMinimatchSourceVerified(source)).toBe(true);
        expect(source.toString()).not.toMatch(/firstPhasePreProcess|secondPhasePreProcess|optimizationLevel/);
        expect(legacyMinimatchSourceVerified(Buffer.concat([source, Buffer.from("\nchanged")]))).toBe(false);
        const item = legacy();
        expect(reviewDependencyAudit(report(item), { legacyMinimatchVerified: true })).toEqual({ accepted: [item], blocked: [] });
        expect(reviewDependencyAudit(report(item)).blocked).toEqual([item]);
    });
    it.each([
        ["affected modern version", (item) => (item.findings[0].version = "10.2.6")],
        ["another legacy version", (item) => (item.findings[0].version = "3.1.4")],
        ["production", (item) => (item.findings[0].dev = false)],
        ["unknown tool", (item) => item.findings[0].paths.push(".>new-tool>minimatch")],
        ["new advisory", (item) => (item.github_advisory_id = "GHSA-other")],
        ["changed affected range", (item) => (item.vulnerable_versions = "<12.0.0")],
        ["changed patch", (item) => (item.patched_versions = ">=11.0.5")],
        ["missing findings", (item) => (item.findings = [])],
    ])("still blocks %s", (_name, change) => {
        const item = legacy();
        change(item);
        expect(reviewDependencyAudit(report(item), { legacyMinimatchVerified: true })).toEqual({ accepted: [], blocked: [item] });
    });
});
