import { describe, expect, it } from "vitest";
import { reviewDependencyAudit } from "./dependency-audit.mjs";

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
        expect(reviewDependencyAudit(report(item))).toEqual({ accepted: [item], blocked: [] });
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
                item.patched_versions = ">=3.0.4";
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
        expect(reviewDependencyAudit(report(item))).toEqual({ accepted: [], blocked: [item] });
    });
    it("rejects missing details for a nonempty vulnerability count", () => {
        expect(() => reviewDependencyAudit({ advisories: {}, metadata: { vulnerabilities: { high: 1 } } })).toThrow("依赖审计缺少漏洞明细");
    });
    it("rejects a registry error instead of treating it as an empty audit", () => {
        expect(() => reviewDependencyAudit({ error: "registry unavailable" })).toThrow("依赖审计响应无效");
    });
});
