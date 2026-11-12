import { describe, expect, it } from "vitest";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../types";
import { buildNodeGenerationContext, buildNodeResponseMessages } from "./canvas-node-generation";

describe("buildNodeGenerationContext", () => {
    it("uses every connected input when the composer has no explicit node mention", () => {
        const context = buildNodeGenerationContext("config", nodes(), connections(), "生成一个新版本");

        expect(context.prompt).toContain("生成一个新版本");
        expect(context.prompt).toContain("【文本1】\n保持红色包装");
        expect(context.referenceImages.map((item) => item.id)).toEqual(["image"]);
        expect(context.referenceVideos.map((item) => item.id)).toEqual(["video"]);
        expect(context).toMatchObject({ textCount: 1, imageCount: 1, videoCount: 1, audioCount: 0 });
    });

    it("keeps explicit node mentions exclusive", () => {
        const context = buildNodeGenerationContext("config", nodes(), connections(), "基于 @[node:image] 生成一个新版本");

        expect(context.prompt).toContain("基于 图片1 生成一个新版本");
        expect(context.prompt).not.toContain("保持红色包装");
        expect(context.referenceImages.map((item) => item.id)).toEqual(["image"]);
        expect(context.referenceVideos).toEqual([]);
        expect(context).toMatchObject({ textCount: 0, imageCount: 1, videoCount: 0, audioCount: 0 });
    });
});

describe("buildNodeResponseMessages", () => {
    it("submits stored image URLs in order without embedding large inline copies", () => {
        const firstUrl = "/api/generation-log-assets/permanent/first.png";
        const secondUrl = "/api/reference-assets/permanent/second.png";
        const inputs = [
            node("first", CanvasNodeType.Image, { content: "data:image/png;base64," + "A".repeat(4 * 1024 * 1024), serverUrl: firstUrl }),
            node("second", CanvasNodeType.Image, { content: secondUrl }),
            node("config", CanvasNodeType.Config, {}),
        ];
        const context = buildNodeGenerationContext(
            "config",
            inputs,
            [
                { id: "first-config", fromNodeId: "first", toNodeId: "config" },
                { id: "second-config", fromNodeId: "second", toNodeId: "config" },
            ],
            "反推提示词",
        );
        const messages = buildNodeResponseMessages(context);

        expect(messages).toEqual([
            {
                role: "user",
                content: [
                    { type: "text", text: "反推提示词" },
                    { type: "image_url", image_url: { url: firstUrl } },
                    { type: "image_url", image_url: { url: secondUrl } },
                ],
            },
        ]);
        expect(new TextEncoder().encode(JSON.stringify({ config: { model: "text-model" }, messages })).byteLength).toBeLessThan(4 * 1024 * 1024);
        expect(context.referenceImages[0].dataUrl).toMatch(/^data:image\/png;base64,/);
    });

    it("keeps an inline image when no stored URL exists", () => {
        const context = buildNodeGenerationContext("config", nodes(), connections(), "识图");
        expect(buildNodeResponseMessages(context)[0].content).toContainEqual({ type: "image_url", image_url: { url: "data:image/png;base64,image" } });
    });

    it("keeps text-only messages unchanged", () => {
        const context = buildNodeGenerationContext("config", [], [], "你好");
        expect(buildNodeResponseMessages(context)).toEqual([{ role: "user", content: "你好" }]);
    });
});

function nodes(): CanvasNodeData[] {
    return [
        node("image", CanvasNodeType.Image, { content: "data:image/png;base64,image" }),
        node("video", CanvasNodeType.Video, { content: "/api/generation-log-assets/video" }),
        node("text", CanvasNodeType.Text, { content: "保持红色包装" }),
        node("config", CanvasNodeType.Config, { composerContent: "生成一个新版本" }),
    ];
}

function connections(): CanvasConnection[] {
    return [
        { id: "image-config", fromNodeId: "image", toNodeId: "config" },
        { id: "video-config", fromNodeId: "video", toNodeId: "config" },
        { id: "text-config", fromNodeId: "text", toNodeId: "config" },
    ];
}

function node(id: string, type: CanvasNodeType, metadata: NonNullable<CanvasNodeData["metadata"]>): CanvasNodeData {
    return { id, type, title: id, position: { x: 0, y: 0 }, width: 320, height: 240, metadata };
}
