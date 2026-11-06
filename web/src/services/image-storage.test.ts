import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { referenceUrl, resolveMetadataReferences } from "@/app/(user)/canvas/[id]/canvas-page-utils";
import type { ReferenceImage } from "@/types/image";
import { resolveStoredImageDataUrl } from "./image-storage";

const key = "permanent/2026/11/06/images/source.png";
const generation = `/api/generation-log-assets/${key}`;
const reference = `/api/reference-assets/${key}`;
const image: ReferenceImage = { id: "source", name: "source.png", type: "image/png", storageKey: key, url: generation, dataUrl: generation };

describe("stored Canvas image references", () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
        fetchMock.mockReset();
        vi.stubGlobal("fetch", fetchMock);
        vi.stubGlobal("window", { location: { origin: "https://vozeb.test" } });
    });

    afterEach(() => vi.unstubAllGlobals());

    it.each([generation, reference])("preserves the media scope through a saved retry: %s", async (url) => {
        const saved = referenceUrl({ ...image, url, dataUrl: url });
        expect(saved).toBe(url);
        await expect(resolveMetadataReferences({ generationType: "edit", references: [saved!] })).resolves.toEqual([expect.objectContaining({ dataUrl: url })]);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("saves the original scoped URL without preview or expired signature parameters", () => {
        expect(referenceUrl({ ...image, url: `https://vozeb.test${generation}?format=webp&width=320&purpose=provider-read&signature=expired&expires=1` })).toBe(generation);
        expect(referenceUrl({ ...image, serverUrl: generation, url: "blob:preview", dataUrl: "data:image/png;base64,eA==" })).toBe(generation);
        expect(referenceUrl({ ...image, url: undefined })).toBe(generation);
    });

    it("does not persist an external URL as a same-origin asset", () => {
        expect(referenceUrl({ ...image, url: `https://other.test${generation}`, dataUrl: "data:image/png;base64,eA==" })).toBe(key);
    });

    it("resolves a saved bare generation key before restoring the retry", async () => {
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 })).mockResolvedValueOnce(new Response(null, { headers: { "Content-Type": "image/png" } }));
        await expect(resolveMetadataReferences({ generationType: "edit", references: [key] })).resolves.toEqual([expect.objectContaining({ id: "0", name: "reference-0.png", storageKey: key, serverUrl: generation, dataUrl: generation })]);
        expect(fetchMock.mock.calls).toEqual([
            [reference, { method: "HEAD", credentials: "same-origin", cache: "no-store" }],
            [generation, { method: "HEAD", credentials: "same-origin", cache: "no-store" }],
        ]);
    });

    it("resolves an uploaded reference without checking the generation directory", async () => {
        fetchMock.mockResolvedValueOnce(new Response(null, { headers: { "Content-Type": "image/jpeg" } }));
        await expect(resolveStoredImageDataUrl(key)).resolves.toBe(reference);
        expect(fetchMock).toHaveBeenCalledExactlyOnceWith(reference, { method: "HEAD", credentials: "same-origin", cache: "no-store" });
    });

    it.each([401, 403, 404])("returns a missing reference instead of a guessed path for HTTP %s", async (status) => {
        fetchMock.mockResolvedValue(new Response(null, { status }));
        await expect(resolveStoredImageDataUrl(key)).resolves.toBe("");
        await expect(resolveMetadataReferences({ generationType: "edit", references: [key] })).resolves.toBeNull();
    });

    it("rejects HTML responses and accepts the verified image in the other scope", async () => {
        fetchMock.mockResolvedValueOnce(new Response(null, { headers: { "Content-Type": "text/html" } })).mockResolvedValueOnce(new Response(null, { headers: { "Content-Type": "image/png; charset=binary" } }));
        await expect(resolveStoredImageDataUrl(key)).resolves.toBe(generation);
    });

    it("handles network errors without returning an unverified reference", async () => {
        fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
        await expect(resolveStoredImageDataUrl(key)).resolves.toBe("");
    });

    it("keeps an explicit scoped fallback without additional requests", async () => {
        await expect(resolveStoredImageDataUrl(key, `https://vozeb.test${generation}?format=webp&width=320`)).resolves.toBe(generation);
        await expect(resolveStoredImageDataUrl(generation)).resolves.toBe(generation);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("normalizes bare storage keys and encodes their path segments", async () => {
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 })).mockResolvedValueOnce(new Response(null, { headers: { "Content-Type": "image/png" } }));
        await expect(resolveStoredImageDataUrl(" permanent\\user\\source image.png ")).resolves.toBe("/api/generation-log-assets/permanent/user/source%20image.png");
    });

    it("keeps data references transient and leaves generations without references unchanged", async () => {
        expect(referenceUrl({ ...image, storageKey: undefined, url: undefined, dataUrl: "data:image/png;base64,eA==" })).toBeUndefined();
        await expect(resolveMetadataReferences({ generationType: "generation" })).resolves.toEqual([]);
        await expect(resolveMetadataReferences({ generationType: "edit", references: [] })).resolves.toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
