import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("release workflow contract", () => {
    it.each(["docker-image.yml", "docs-docker-image.yml"])("gates %s behind quality and signs immutable digests", (file) => {
        const source = workflow(file);
        const parsed = parseDocument(source);

        expect(parsed.errors).toEqual([]);
        const jobs = parsed.toJS().jobs;
        expect(source).not.toContain('branches: ["main"]');
        expect(source).toContain("quality:");
        expect(jobs.build.needs).toEqual(["quality", "security", "meta"]);
        expect(source).toContain("type=raw,value=latest,enable=${{ startsWith(github.ref, 'refs/tags/v')");
        expect(source).toContain("anchore/sbom-action@e22c389904149dbc22b58101806040fa8d37a610");
        expect(source).toContain("cosign sign --yes");
        expect(source).toContain("cosign attest --yes");
        expect(source).toContain("awk '/^Digest:/ && digest == \"\" { digest = $2 } END { print digest }'");
        expect(source).not.toContain("awk '/^Digest:/ { print $2; exit }'");
        expect(source).toContain("version: 11.9.0");
        expect(source).not.toMatch(/uses:\s+[^\s]+@(v\d|main|master)\b/);
    });

    it.each([
        ["docker-image.yml", ""],
        ["docs-docker-image.yml", "-docs"],
    ])("publishes %s to the current repository namespace through every image job", (file, suffix) => {
        const document = parseDocument(workflow(file));
        expect(document.errors).toEqual([]);
        const config = document.toJS();
        const { jobs } = config;
        expect(config.env?.IMAGE_NAME).toBeUndefined();
        const imageStep = jobs.meta.steps.find((step) => step.id === "image");
        expect(imageStep.shell).toBe("bash");
        expect(imageStep.run).toContain("name=ghcr.io/${GITHUB_REPOSITORY,,}" + suffix);
        expect(jobs.meta.outputs.image).toBe("${{ steps.image.outputs.name }}");
        expect(jobs.meta.steps.find((step) => step.id === "meta").with.images).toBe("${{ steps.image.outputs.name }}");
        for (const job of [jobs.build, jobs.merge, jobs.attest]) {
            expect(job.needs).toContain("meta");
            expect(job.env.IMAGE_NAME).toBe("${{ needs.meta.outputs.image }}");
            expect(job.permissions.packages).toBe("write");
        }
        expect(jobs.attest.needs).toContain("merge");
        expect(workflow(file)).not.toContain("ghcr.io/csyqlz/");
    });

    it("runs lint, tests, type-check, build and browser E2E in the main quality workflow", () => {
        const source = workflow("quality.yml");

        expect(parseDocument(source).errors).toEqual([]);
        for (const command of ["pnpm run lint", "pnpm run typecheck", "pnpm test", "pnpm run build", "pnpm run e2e"]) expect(source).toContain(command);
        expect(source).toContain("pnpm exec playwright install --with-deps chromium");
        expect(source).toContain("version: 11.9.0");
        expect(source).toContain("gitleaks/gitleaks-action@ff98106e4c7b2bc287b24eaf42907196329070c7");
        expect(source).toContain("github/codeql-action/analyze@47be0dbd5113ab1b79fe2dd3f68bdf7e426cdc87");
        expect(source).not.toMatch(/uses:\s+[^\s]+@(v\d|main|master)\b/);
    });

    it.each([
        ["quality.yml", "web"],
        ["docker-image.yml", "quality"],
    ])("serializes shared PostgreSQL integration tests in %s", (file, job) => {
        const document = parseDocument(workflow(file));
        expect(document.errors).toEqual([]);

        const step = document.toJS().jobs[job].steps.find((item) => item.name === "PostgreSQL integration tests");
        expect(step?.run).toContain("pnpm exec vitest run --no-file-parallelism");
    });

    it.each([
        ["quality.yml", "web"],
        ["docker-image.yml", "quality"],
    ])("keeps production auditing strict and reviews development exceptions in %s", (file, job) => {
        const steps = parseDocument(workflow(file)).toJS().jobs[job].steps;
        const commands = steps.map((step) => step.run || "").join("\n");
        expect(commands).toContain("pnpm audit --prod --audit-level moderate");
        expect(commands).toContain("node scripts/dependency-audit.mjs");
        expect(steps.some((step) => step["continue-on-error"])).toBe(false);
    });

    it("declares one pnpm version for the repository and both Docker builds", () => {
        const rootPackage = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
        const appDockerfile = readFileSync(path.join(repoRoot, "Dockerfile"), "utf8");
        const docsDockerfile = readFileSync(path.join(repoRoot, "docs/Dockerfile"), "utf8");

        expect(rootPackage.packageManager).toBe("pnpm@11.9.0");
        expect(appDockerfile).toContain("ARG PNPM_VERSION=11.9.0");
        expect(docsDockerfile).toContain("pnpm@11.9.0");
    });

    it("keeps automated dependency PRs within supported major versions", () => {
        const document = parseDocument(readFileSync(path.join(repoRoot, ".github/dependabot.yml"), "utf8"));
        expect(document.errors).toEqual([]);

        const updates = document.toJS().updates;
        const web = updates.find((item) => item["package-ecosystem"] === "npm" && item.directory === "/web");
        const docs = updates.find((item) => item["package-ecosystem"] === "npm" && item.directory === "/docs");
        const actions = updates.find((item) => item["package-ecosystem"] === "github-actions");
        const docker = updates.filter((item) => item["package-ecosystem"] === "docker");

        expect(web.groups["web-runtime"]["update-types"]).toEqual(["minor", "patch"]);
        expect(web.groups["web-development"]["update-types"]).toEqual(["minor", "patch"]);
        expect(web.ignore.map((item) => item["dependency-name"])).toEqual(["*"]);
        expect(docs.groups["docs-dependencies"]["update-types"]).toEqual(["minor", "patch"]);
        expect(docs.ignore.map((item) => item["dependency-name"])).toEqual(["*"]);
        expect(actions.ignore.map((item) => item["dependency-name"])).toEqual(["*"]);
        expect([...web.ignore, ...docs.ignore, ...actions.ignore, ...docker.flatMap((item) => item.ignore)].every((item) => item["update-types"][0] === "version-update:semver-major")).toBe(true);
        expect(docker).toHaveLength(2);
        expect(docker.every((item) => item.ignore[0]["dependency-name"] === "node")).toBe(true);
    });
});

function workflow(file) {
    return readFileSync(path.join(repoRoot, ".github/workflows", file), "utf8");
}
