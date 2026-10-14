import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { CREATIVE_UPLOAD_MAX_BYTES } from "@/lib/creative-upload";
import { agentTextContent, resolveTextMessageImages, textWithImages } from "./agent-text-input";
import type { LocalMediaRegistration } from "./local-media-registry";

const mocks = vi.hoisted(() => ({ root: "", registration: vi.fn(), signedUrl: vi.fn(), fetch: vi.fn() }));
vi.mock("./data-dir", () => ({ getServerDataDir: () => mocks.root }));
vi.mock("./local-media-registry", async (importOriginal) => ({ ...(await importOriginal<typeof import("./local-media-registry")>()), getLocalMediaRegistration: mocks.registration }));
vi.mock("./object-storage-service", () => ({ createExternalMediaReadUrl: mocks.signedUrl }));
vi.mock("./safe-outbound-fetch", () => ({ fetchSafeOutbound: mocks.fetch }));

const key = "permanent/fixture.png";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVR4nGPQq/3/H4QZYAwAWewKpRUlAtEAAAAASUVORK5CYII=", "base64");
const dataUrl = "data:image/png;base64," + png.toString("base64");
const url = "/api/reference-assets/" + key;
let registration: LocalMediaRegistration;

beforeAll(async () => {
    mocks.root = await mkdtemp(join(tmpdir(), "vozeb-agent-images-"));
    for (const scope of ["reference-assets", "generation-assets"]) {
        await mkdir(join(mocks.root, scope, "permanent"), { recursive: true });
        await writeFile(join(mocks.root, scope, key), png);
    }
});
afterAll(async () => {
    await rm(mocks.root, { recursive: true, force: true });
});
beforeEach(() => {
    vi.clearAllMocks();
    registration = { storageKey: key, scope: "reference", storageClass: "permanent", type: "image", ownerUserId: "user", source: "fixture", mimeType: "image/png", bytes: png.length, storageProvider: "local", createdAt: "2026-01-01T00:00:00Z" };
    mocks.registration.mockImplementation(async () => registration);
});

describe("Agent actual image inputs", () => {
    it("hydrates stored media URLs without replacing the persisted task input", async () => {
        const messages = [{ role: "user" as const, content: textWithImages("反推提示词", [url]) }];
        expect(await resolveTextMessageImages(messages, "user")).toEqual([
            {
                role: "user",
                content: [
                    { type: "text", text: "反推提示词" },
                    { type: "image_url", image_url: { url: dataUrl } },
                ],
            },
        ]);
        expect(messages).toEqual([
            {
                role: "user",
                content: [
                    { type: "text", text: "反推提示词" },
                    { type: "image_url", image_url: { url } },
                ],
            },
        ]);
    });
    it("preserves unrelated text, public URLs and inline images during hydration", async () => {
        const messages = [
            { role: "user" as const, content: textWithImages("识图", ["https://example.com/public.png", dataUrl]) },
            { role: "assistant" as const, content: "上一轮回答" },
        ];
        expect(await resolveTextMessageImages(messages, "user")).toEqual(messages);
        expect(mocks.registration).not.toHaveBeenCalled();
    });

    it("keeps text-only input unchanged", async () => {
        expect(await agentTextContent("你好", [], "user")).toBe("你好");
        expect(mocks.registration).not.toHaveBeenCalled();
    });
    it.each(["reference", "generation"] as const)("inlines owned %s media bytes without creating another asset", async (scope) => {
        registration.scope = scope;
        const route = scope === "reference" ? "/api/reference-assets/" : "/api/generation-log-assets/";
        expect(await agentTextContent("反推提示词", [route + key], "user")).toEqual([
            { type: "text", text: "反推提示词" },
            { type: "image_url", image_url: { url: dataUrl } },
        ]);
        expect(mocks.fetch).not.toHaveBeenCalled();
    });
    it("reads the registered object storage source and sends its actual bytes", async () => {
        registration.storageProvider = "object";
        mocks.signedUrl.mockResolvedValue("https://objects.example.com/fixture.png?signature=fixture");
        mocks.fetch.mockResolvedValue(new Response(png));
        expect(await agentTextContent("分析图片", [url], "user")).toEqual([
            { type: "text", text: "分析图片" },
            { type: "image_url", image_url: { url: dataUrl } },
        ]);
        expect(mocks.signedUrl).toHaveBeenCalledWith(expect.any(Request), registration);
    });
    it.each(["foreign", "expired", "missing", "non-image"])("rejects %s assets before requesting an upstream model", async (kind) => {
        if (kind === "foreign") registration.ownerUserId = "another-user";
        if (kind === "expired") {
            registration.storageClass = "temporary";
            registration.expiresAt = "2000-01-01T00:00:00Z";
        }
        if (kind === "missing") mocks.registration.mockResolvedValue(null);
        if (kind === "non-image") registration.type = "video";
        await expect(agentTextContent("分析图片", [url], "user")).rejects.toThrow("参考图片不存在、已过期或无权读取");
        expect(mocks.fetch).not.toHaveBeenCalled();
    });
    it("preserves attachment order, removes duplicate inputs and does not truncate images", async () => {
        const urls = Array.from({ length: 7 }, (_, index) => "https://example.com/" + index + ".png");
        expect(await agentTextContent("逐图分析", [...urls, urls[0]], "user")).toEqual([{ type: "text", text: "逐图分析" }, ...urls.map((url) => ({ type: "image_url", image_url: { url } }))]);
    });
    it("accepts inline image input and rejects an unreadable relative address", async () => {
        expect(await agentTextContent("分析图片", [dataUrl], "user")).toEqual([
            { type: "text", text: "分析图片" },
            { type: "image_url", image_url: { url: dataUrl } },
        ]);
        await expect(agentTextContent("分析图片", ["/unknown/image.png"], "user")).rejects.toThrow("参考图片地址无效");
    });
    it("enforces the existing upload size contract", async () => {
        registration.bytes = CREATIVE_UPLOAD_MAX_BYTES + 1;
        await expect(agentTextContent("分析图片", [url], "user")).rejects.toThrow("参考图片超过上传大小限制");
    });
    it("reports object read failures instead of silently sending text only", async () => {
        registration.storageProvider = "object";
        mocks.signedUrl.mockResolvedValue("https://objects.example.com/fixture.png");
        mocks.fetch.mockResolvedValue(new Response(null, { status: 404 }));
        await expect(agentTextContent("分析图片", [url], "user")).rejects.toThrow("参考图片读取失败");
    });
    it("keeps local reads inside the registered media directory", async () => {
        await expect(agentTextContent("分析图片", ["/api/reference-assets/../../outside.png"], "user")).rejects.toThrow("参考图片地址无效");
    });
});
