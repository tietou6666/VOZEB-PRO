import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vitest";

import { canvasResourceMentionAtCursor, CanvasResourceMentionText, CanvasResourceMentionTextarea } from "./canvas-resource-mention-textarea";

const imageReference = { id: "image-1", nodeId: "image-1", kind: "image" as const, label: "图片1", title: "参考图片", previewUrl: "/reference.png", active: true };

describe("Canvas resource mention preview", () => {
    it("opens mentions after existing Chinese prompt text and punctuation", () => {
        const afterText = "生成一张海报@图";
        const afterPunctuation = "保持人物一致，@视";
        const afterDigits = "222@";
        expect(canvasResourceMentionAtCursor(afterText, afterText.length)).toEqual({ start: 6, end: 8, query: "图" });
        expect(canvasResourceMentionAtCursor(afterPunctuation, afterPunctuation.length)).toEqual({ start: 7, end: 9, query: "视" });
        expect(canvasResourceMentionAtCursor(afterDigits, afterDigits.length)).toEqual({ start: 3, end: 4, query: "" });
    });

    it("renders an image thumbnail for a referenced image label in read-only text", () => {
        const markup = renderToStaticMarkup(
            <CanvasResourceMentionText
                value="请参考 图片1 继续创作"
                references={[
                    {
                        id: "image-1",
                        nodeId: "image-1",
                        kind: "image",
                        label: "图片1",
                        title: "参考图片",
                        previewUrl: "/reference.png",
                        active: true,
                    },
                ]}
            />,
        );

        expect(markup).toContain('data-canvas-resource-reference="image-1"');
        expect(markup).toContain("参考图片");
        expect(markup).toContain("图片1");
        expect(markup).toContain("<img");
    });

    it("keeps the editable caret above the highlight overlay", () => {
        const markup = renderToStaticMarkup(<CanvasResourceMentionTextarea value="请参考 图片1 继续创作" references={[imageReference]} onChange={() => {}} />);

        expect(markup).toContain("absolute inset-0 z-0");
        expect(markup).toContain("<textarea");
        expect(markup).toMatch(/<textarea[^>]*class="[^"]*relative z-\[1\]/);
        expect(markup).toContain("caret-color");
    });

    it("reserves the exact label width inside the highlight overlay", () => {
        const markup = renderToStaticMarkup(<CanvasResourceMentionTextarea value="请参考 图片1 继续创作" references={[imageReference]} onChange={() => {}} />);
        const token = markup.slice(markup.indexOf('data-canvas-resource-reference="image-1"'));

        expect(token).toContain('<span class="whitespace-pre">图片1</span>');
        expect(token).toContain("absolute inset-0 inline-flex");
        expect(token).toContain("justify-center");
        expect(token).not.toContain("<img");
        expect(token).not.toContain("mx-0.5");
        expect(token).not.toContain("px-1 py-0.5");
    });
});
