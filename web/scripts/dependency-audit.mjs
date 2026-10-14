import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Upstream has no fix. Only trusted lint/scaffolding tools reach braces; production must stay unaffected.
const developmentAdvisory = "GHSA-vfj7-8cjw-p6xm";

export function reviewDependencyAudit(report) {
    if (!report?.advisories || !report.metadata?.vulnerabilities) throw new Error("依赖审计响应无效");
    if (Object.values(report.metadata.vulnerabilities).some((count) => count > 0) && !Object.keys(report.advisories).length) throw new Error("依赖审计缺少漏洞明细");
    const accepted = [];
    const blocked = [];
    for (const advisory of Object.values(report.advisories)) {
        if (!["info", "low", "moderate", "high", "critical"].includes(advisory.severity)) throw new Error("依赖审计严重程度无效");
        const findings = advisory.findings || [];
        const developmentOnly =
            advisory.github_advisory_id === developmentAdvisory &&
            advisory.module_name === "braces" &&
            advisory.patched_versions === null &&
            findings.length > 0 &&
            findings.every((finding) => finding.version === "3.0.3" && finding.dev === true && finding.paths?.length > 0 && finding.paths.every((path) => path.startsWith(".>eslint-config-next>") || path.startsWith(".>shadcn>")));
        if (developmentOnly) accepted.push(advisory);
        else if (["moderate", "high", "critical"].includes(advisory.severity)) blocked.push(advisory);
    }
    return { accepted, blocked };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const windows = process.platform === "win32";
    const result = spawnSync(windows ? "cmd.exe" : "pnpm", windows ? ["/d", "/s", "/c", "pnpm audit --json"] : ["audit", "--json"], { encoding: "utf8" });
    if (result.error || result.signal || ![0, 1].includes(result.status)) throw result.error || new Error(result.stderr || "依赖审计执行失败");
    const report = JSON.parse(result.stdout);
    const { accepted, blocked } = reviewDependencyAudit(report);
    for (const advisory of accepted) console.warn("开发工具依赖例外（仍未修复）:", advisory.github_advisory_id, advisory.title);
    for (const advisory of blocked) console.error("依赖审计阻断:", advisory.github_advisory_id, advisory.title);
    console.log("原始漏洞统计:", JSON.stringify(report.metadata.vulnerabilities));
    process.exitCode = blocked.length ? 1 : 0;
}
