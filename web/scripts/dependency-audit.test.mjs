import { describe, expect, it } from "vitest";
import { bracesFixUnavailable, reviewDependencyAudit } from "./dependency-audit.mjs";

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
