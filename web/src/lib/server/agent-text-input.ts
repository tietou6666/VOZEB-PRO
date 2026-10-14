import { readFile, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";

import { CREATIVE_UPLOAD_MAX_BYTES } from "@/lib/creative-upload";
import type { AiTextMessage } from "@/types/ai";
import { getServerDataDir } from "./data-dir";
import { localMediaStorageKeyFromValue } from "./local-media-references";
import { getLocalMediaRegistration, isLocalMediaRegistrationExpired } from "./local-media-registry";
import { limitMediaResponseBody } from "./media-response-limit";
import { TEXT_MODEL_REQUEST_TIMEOUT_MS } from "./model-request-policy";
import { createExternalMediaReadUrl } from "./object-storage-service";
import { fetchSafeOutbound } from "./safe-outbound-fetch";

export async function agentTextContent(prompt: string, urls: string[], userId: string): Promise<AiTextMessage["content"]> {
    const images = await Promise.all(Array.from(new Set(urls)).map((url) => agentImageInput(url, userId)));
    return textWithImages(prompt, images);
}

export function textWithImages(prompt: string, urls: string[]): AiTextMessage["content"] {
    return urls.length ? [{ type: "text", text: prompt }, ...urls.map((url) => ({ type: "image_url" as const, image_url: { url } }))] : prompt;
}

export function resolveTextMessageImages(messages: AiTextMessage[], userId: string): Promise<AiTextMessage[]> {
    return Promise.all(
        messages.map(async (message) => ({
            ...message,
            content: Array.isArray(message.content)
                ? await Promise.all(message.content.map(async (part) => (part.type === "image_url" && localMediaStorageKeyFromValue(part.image_url.url) ? { ...part, image_url: { url: await agentImageInput(part.image_url.url, userId) } } : part)))
                : message.content,
        })),
    );
}

async function agentImageInput(value: string, userId: string) {
    const storageKey = localMediaStorageKeyFromValue(value);
    if (!storageKey) {
        if (/^https?:\/\//i.test(value)) return value;
        const data = value.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=]+)$/i);
        if (!data || !Buffer.from(data[2], "base64").length) throw new Error("参考图片地址无效，无法读取实际画面");
        if (Buffer.byteLength(data[2], "base64") > CREATIVE_UPLOAD_MAX_BYTES) throw new Error("参考图片超过上传大小限制");
        return value;
    }
    const registration = await getLocalMediaRegistration(storageKey);
    if (!registration || registration.ownerUserId !== userId || registration.type !== "image" || isLocalMediaRegistrationExpired(registration)) throw new Error("参考图片不存在、已过期或无权读取");
    if (registration.bytes > CREATIVE_UPLOAD_MAX_BYTES) throw new Error("参考图片超过上传大小限制");
    let bytes: Buffer;
    if (registration.storageProvider === "object") {
        const url = await createExternalMediaReadUrl(new Request("http://localhost/"), registration);
        if (!url) throw new Error("参考图片读取失败");
        const response = await fetchSafeOutbound(url, { signal: AbortSignal.timeout(TEXT_MODEL_REQUEST_TIMEOUT_MS) });
        if (!response.ok) throw new Error("参考图片读取失败");
        bytes = Buffer.from(await new Response(limitMediaResponseBody(response.body, CREATIVE_UPLOAD_MAX_BYTES, TEXT_MODEL_REQUEST_TIMEOUT_MS)).arrayBuffer());
    } else {
        const mediaRoot = resolve(getServerDataDir(), registration.scope === "reference" ? "reference-assets" : "generation-assets");
        const filePath = resolve(mediaRoot, storageKey);
        if (!filePath.startsWith(mediaRoot + sep)) throw new Error("参考图片地址无效");
        if ((await stat(filePath)).size > CREATIVE_UPLOAD_MAX_BYTES) throw new Error("参考图片超过上传大小限制");
        bytes = await readFile(filePath);
    }
    if (!bytes.length || bytes.length > CREATIVE_UPLOAD_MAX_BYTES || !registration.mimeType.startsWith("image/")) throw new Error("参考图片内容无效");
    return "data:" + registration.mimeType + ";base64," + bytes.toString("base64");
}
