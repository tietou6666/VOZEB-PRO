import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ root: "", registration: vi.fn(), signedUrl: vi.fn(), outbound: vi.fn(), internal: vi.fn() }));
vi.mock("@/lib/server/data-dir", async (original) => ({ ...(await original<typeof import("@/lib/server/data-dir")>()), getServerDataDir: () => mocks.root }));
vi.mock("@/lib/server/local-media-registry", async (original) => ({ ...(await original<typeof import("@/lib/server/local-media-registry")>()), getLocalMediaRegistration: mocks.registration }));
vi.mock("@/lib/server/object-storage-service", () => ({ createExternalMediaReadUrl: mocks.signedUrl }));
vi.mock("@/lib/server/safe-outbound-fetch", () => ({ fetchSafeOutbound: mocks.outbound }));
vi.mock("@/lib/server/internal-origin", async (original) => ({ ...(await original<typeof import("@/lib/server/internal-origin")>()), fetchInternalApi: mocks.internal }));

import type { ImageTask } from "@/lib/server/image-task-store";
import type { LocalMediaRegistration } from "@/lib/server/local-media-registry";
import { buildImageEditFormData, imageReferenceToDataUrl, imageReferenceToFile } from "./image-task-support";
import { MAX_INLINE_IMAGE_BYTES } from "./image-task-types";

const key = "permanent/2026/11/12/images/source.png";
const url = "/api/reference-assets/" + key;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVR4nGPQq/3/H4QZYAwAWewKpRUlAtEAAAAASUVORK5CYII=", "base64");
const origin = "http://127.0.0.1:3000";
const context = { ownerUserId: "user-one", taskId: "task-one" };
let registration: LocalMediaRegistration;

beforeAll(async () => {
    mocks.root = await mkdtemp(join(tmpdir(), "vozeb-reference-read-"));
    for (const scope of ["reference-assets", "generation-assets"]) {
        await mkdir(join(mocks.root, scope, "permanent/2026/11/12/images"), { recursive: true });
        await writeFile(join(mocks.root, scope, key), png);
    }
});
afterAll(async () => {
    await rm(mocks.root, { recursive: true, force: true });
});
beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://studio.example.com");
    registration = {
        storageKey: key,
        scope: "reference",
        storageClass: "permanent",
        type: "image",
        ownerUserId: context.ownerUserId,
        source: "fixture",
        mimeType: "image/png",
        bytes: png.length,
        storageProvider: "local",
        createdAt: "2026-11-12T00:00:00Z",
    };
    mocks.registration.mockImplementation(async () => registration);
    mocks.internal.mockResolvedValue(Response.json({ msg: "媒体并发访问过多" }, { status: 429 }));
});
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
});

describe("authorized image reference reads", () => {
    it("prepares four tasks with four original references each without using the throttled media API", async () => {
        const tasks = Array.from(
            { length: 4 },
            (_, index) =>
                ({
                    id: `task-${index}`,
                    userId: context.ownerUserId,
                    prompt: "fixture",
                    kind: "edit",
                    config: { model: "fixture-image", apiFormat: "openai" },
                    references: Array.from({ length: 4 }, (_, ref) => ({ id: String(ref), dataUrl: url })),
                    mask: { dataUrl: url },
                }) as ImageTask,
        );
        const forms = await Promise.all(tasks.map((task) => buildImageEditFormData(task, undefined, undefined, origin, "", "url")));
        for (const form of forms) {
            expect(form.getAll("image")).toHaveLength(4);
            for (const file of [...form.getAll("image"), form.get("mask")]) {
                expect(file).toBeInstanceOf(File);
                expect(Buffer.from(await (file as File).arrayBuffer())).toEqual(png);
            }
        }
        expect(mocks.internal).not.toHaveBeenCalled();
        expect(mocks.outbound).not.toHaveBeenCalled();
    });

    it.each(["reference", "generation"] as const)("reads registered %s originals and discards preview and expired signature parameters", async (scope) => {
        registration.scope = scope;
        const prefix = scope === "reference" ? "/api/reference-assets/" : "/api/generation-log-assets/";
        const file = await imageReferenceToFile({ dataUrl: `https://studio.example.com${prefix}${key}?format=webp&width=256&signature=expired` }, "original.png", origin, "", context);
        expect(Buffer.from(await file.arrayBuffer())).toEqual(png);
        expect(file.type).toBe("image/png");
        expect(mocks.internal).not.toHaveBeenCalled();
        expect(mocks.outbound).not.toHaveBeenCalled();
    });

    it("prefers registered originals over stale remote URLs and never bypasses ownership through a fallback", async () => {
        const reference = { serverUrl: url, remoteUrl: "https://external.example.com/expired.png", dataUrl: "data:image/png;base64," + png.toString("base64") };
        expect(Buffer.from(await (await imageReferenceToFile(reference, "source.png", origin, "", context)).arrayBuffer())).toEqual(png);
        expect(await imageReferenceToDataUrl(reference, "source.png", origin, "", context)).toBe(reference.dataUrl);
        registration.ownerUserId = "another-user";
        await expect(imageReferenceToFile(reference, "source.png", origin, "", context)).rejects.toThrow("无权读取");
        await expect(imageReferenceToDataUrl(reference, "source.png", origin, "", context)).rejects.toThrow("无权读取");
        expect(mocks.outbound).not.toHaveBeenCalled();
    });

    it.each(["missing", "foreign", "expired", "wrong-scope", "non-image"])("rejects %s registrations before reading or requesting an upstream", async (kind) => {
        if (kind === "missing") mocks.registration.mockResolvedValue(null);
        if (kind === "foreign") registration.ownerUserId = "another-user";
        if (kind === "expired") Object.assign(registration, { storageClass: "temporary", expiresAt: "2000-01-01T00:00:00Z" });
        if (kind === "wrong-scope") registration.scope = "generation";
        if (kind === "non-image") registration.type = "video";
        await expect(imageReferenceToFile({ dataUrl: url }, "source.png", origin, "", context)).rejects.toThrow("参考图不存在、已过期或无权读取");
        expect(mocks.internal).not.toHaveBeenCalled();
        expect(mocks.outbound).not.toHaveBeenCalled();
    });

    it("reports a missing local original without exposing its filesystem path", async () => {
        await expect(imageReferenceToFile({ dataUrl: url.replace("source.png", "missing.png") }, "source.png", origin, "", context)).rejects.toThrow("参考图源文件不存在（存储登记仍存在）");
        expect(console.error).toHaveBeenCalledWith("Managed image reference read failed", expect.objectContaining({ taskId: context.taskId, code: "ENOENT" }));
    });

    it("enforces the existing size contract", async () => {
        registration.bytes = MAX_INLINE_IMAGE_BYTES + 1;
        await expect(imageReferenceToFile({ dataUrl: url }, "source.png", origin, "", context)).rejects.toThrow("参考图过大");
        expect(mocks.outbound).not.toHaveBeenCalled();
    });

    it("reads an object original using its registration without calling the browser media route", async () => {
        registration.storageProvider = "object";
        mocks.signedUrl.mockResolvedValue("https://objects.example.com/source.png?signature=secret");
        mocks.outbound.mockResolvedValue(new Response(png, { headers: { "content-type": "image/png" } }));
        const file = await imageReferenceToFile({ dataUrl: url + "?format=webp&width=256" }, "source.png", origin, "", context);
        expect(Buffer.from(await file.arrayBuffer())).toEqual(png);
        expect(new URL(mocks.signedUrl.mock.calls[0][0].url).search).toBe("");
        expect(mocks.signedUrl.mock.calls[0][1]).toBe(registration);
        expect(mocks.internal).not.toHaveBeenCalled();
    });

    it("preserves object storage HTTP errors without exposing signed URLs", async () => {
        registration.storageProvider = "object";
        mocks.signedUrl.mockResolvedValue("https://objects.example.com/source.png?signature=secret");
        mocks.outbound.mockResolvedValue(new Response("private storage details", { status: 403 }));
        await expect(imageReferenceToFile({ dataUrl: url }, "source.png", origin, "", context)).rejects.toThrow("HTTP 403");
        expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/signature=secret|private storage details/);
    });

    it("bounds an object stream even when its response omits content length", async () => {
        registration.storageProvider = "object";
        mocks.signedUrl.mockResolvedValue("https://objects.example.com/source.png");
        const cancel = vi.fn();
        mocks.outbound.mockResolvedValue(
            new Response(
                new ReadableStream({
                    start(controller) {
                        controller.enqueue(new Uint8Array(MAX_INLINE_IMAGE_BYTES + 1));
                    },
                    cancel,
                }),
            ),
        );
        await expect(imageReferenceToFile({ dataUrl: url }, "source.png", origin, "", context)).rejects.toThrow("参考图过大");
        expect(cancel).toHaveBeenCalled();
    });

    it.each([
        [401, "登录凭证"],
        [403, "无权读取"],
        [404, "文件不存在"],
        [429, "限流"],
        [503, "存储服务"],
    ] as const)("preserves HTTP %i with a safe specific reason", async (status, reason) => {
        mocks.outbound.mockImplementation(async () => new Response("private upstream details and credentials", { status }));
        await expect(imageReferenceToFile({ dataUrl: "https://external.example.com/source.png" }, "source.png", origin, "session=private", context)).rejects.toThrow(new RegExp(`HTTP ${status}.*${reason}`));
        expect(console.error).toHaveBeenCalledWith("Image reference HTTP read failed", { taskId: context.taskId, status, source: "external" });
        expect(mocks.registration).not.toHaveBeenCalled();
        expect(mocks.outbound.mock.calls[0][1].headers).toBeUndefined();
    });

    it("keeps another origin's media-like path external", async () => {
        mocks.outbound.mockResolvedValue(new Response(png));
        await imageReferenceToFile({ dataUrl: "https://external.example.com" + url }, "source.png", origin, "", context);
        expect(mocks.registration).not.toHaveBeenCalled();
        expect(mocks.outbound).toHaveBeenCalled();
    });

    it("keeps authenticated HTTP handling for callers without a trusted task identity", async () => {
        await expect(imageReferenceToFile({ dataUrl: url }, "source.png", origin, "session=private")).rejects.toThrow("HTTP 429");
        expect(mocks.registration).not.toHaveBeenCalled();
        expect(mocks.internal).toHaveBeenCalledWith(origin + url, expect.objectContaining({ headers: { cookie: "session=private" } }));
    });
});
