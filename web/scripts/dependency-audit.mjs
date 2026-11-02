import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Upstream has no fix. Only trusted lint/scaffolding tools reach braces; production must stay unaffected.
const developmentAdvisory = "GHSA-vfj7-8cjw-p6xm";
const legacyMinimatchAdvisory = "GHSA-g3hv-75wg-m249";

// The advisory concerns firstPhasePreProcess/secondPhasePreProcess at optimizationLevel >= 2.
// Official minimatch 3.1.5 has neither algorithm: make() only maps and parses globParts.
// Pin the reviewed source, not just the advisory's overbroad <11 version range.
export function legacyMinimatchSourceVerified(source) {
    return createHash("sha256").update(source).digest("hex") === "746849f267c4868a53729225bd85c7dccd387712136fb305fcc0a3eadd4a3d9d";
}

export function reviewDependencyAudit(report, { fixUnavailable = false, legacyMinimatchVerified = false } = {}) {
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
            fixUnavailable &&
            [null, ">=3.0.4"].includes(advisory.patched_versions) &&
            findings.length > 0 &&
            findings.every((finding) => finding.version === "3.0.3" && finding.dev === true && finding.paths?.length > 0 && finding.paths.every((path) => path.startsWith(".>eslint-config-next>") || path.startsWith(".>shadcn>")));
        const legacyMinimatchFalsePositive =
            advisory.github_advisory_id === legacyMinimatchAdvisory &&
            advisory.module_name === "minimatch" &&
            legacyMinimatchVerified &&
            advisory.vulnerable_versions === "<11.0.1" &&
            advisory.patched_versions === ">=11.0.1" &&
            findings.length > 0 &&
            findings.every((finding) => finding.version === "3.1.5" && finding.dev === true && finding.paths?.length > 0 && finding.paths.every((path) => path.startsWith(".>eslint>") || path.startsWith(".>eslint-config-next>")));
        if (developmentOnly || legacyMinimatchFalsePositive) accepted.push(advisory);
        else if (["moderate", "high", "critical"].includes(advisory.severity)) blocked.push(advisory);
    }
    return { accepted, blocked };
}

export function bracesFixUnavailable(result) {
    if (result.error || result.signal || ![0, 1].includes(result.status)) throw result.error || new Error(result.stderr || "修复版本查询失败");
    const report = JSON.parse(result.stdout);
    if (result.status === 1 && report.error?.code === "ERR_PNPM_PACKAGE_NOT_FOUND") return true;
    if (result.status === 0 && (typeof report === "string" || (Array.isArray(report) && report.length > 0 && report.every((version) => typeof version === "string")))) return false;
    throw new Error("修复版本查询响应无效");
}

function runPnpm(args) {
    const windows = process.platform === "win32";
    return spawnSync(windows ? "cmd.exe" : "pnpm", windows ? ["/d", "/s", "/c", ["pnpm", ...args.map((arg) => (arg.includes(">") ? '"' + arg + '"' : arg))].join(" ")] : args, { encoding: "utf8", windowsVerbatimArguments: windows });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const result = runPnpm(["audit", "--json"]);
    if (result.error || result.signal || ![0, 1].includes(result.status)) throw result.error || new Error(result.stderr || "依赖审计执行失败");
    const report = JSON.parse(result.stdout);
    const fixUnavailable = Object.values(report.advisories || {}).some((advisory) => advisory.github_advisory_id === developmentAdvisory) && bracesFixUnavailable(runPnpm(["view", "braces@>=3.0.4", "version", "--json"]));
    const require = createRequire(import.meta.url);
    const legacyMinimatchVerified = legacyMinimatchSourceVerified(readFileSync(require.resolve("minimatch", { paths: [require.resolve("eslint/package.json")] })));
    const { accepted, blocked } = reviewDependencyAudit(report, { fixUnavailable, legacyMinimatchVerified });
    for (const advisory of accepted) console.warn(advisory.github_advisory_id === legacyMinimatchAdvisory ? "已核对源码的开发依赖误报:" : "开发工具依赖例外（仍未修复）:", advisory.github_advisory_id, advisory.title);
    for (const advisory of blocked) console.error("依赖审计阻断:", advisory.github_advisory_id, advisory.title);
    console.log("原始漏洞统计:", JSON.stringify(report.metadata.vulnerabilities));
    process.exitCode = blocked.length ? 1 : 0;
}
