import { describe, expect, it } from "vitest";

import { buildOpenAiVideoFormData } from "./video-task-openai";

describe("deployed Grok multipart resolution contract", () => {
    it.each(["grok-imagine-video-1.5-preview", "grok-imagine-video-1.5"])("preserves explicit resolution for %s with automatic aspect ratio", async (model) => {
        for (const resolution of ["480p", "720p"]) {
            const form = await buildOpenAiVideoFormData({ model, prompt: "fixture", seconds: 10, resolution, imageUrls: [], origin: "http://localhost", cookie: "" });
            expect(form.get("resolution")).toBe(resolution);
            expect(form.has("size")).toBe(false);
        }
    });
    it("keeps other OpenAI video forms unchanged", async () => {
        const form = await buildOpenAiVideoFormData({ model: "sora-2", prompt: "fixture", seconds: 10, resolution: "720p", imageUrls: [], origin: "http://localhost", cookie: "" });
        expect(form.has("resolution")).toBe(false);
    });
});
