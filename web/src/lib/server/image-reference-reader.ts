import { readFile, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";

import { getServerDataDir } from "./data-dir";
import { toSafeGenerationErrorMessage } from "./generation-errors";
import { getLocalMediaRegistration, isLocalMediaRegistrationExpired } from "./local-media-registry";
import { limitMediaResponseBody } from "./media-response-limit";
import { createExternalMediaReadUrl } from "./object-storage-service";
import { fetchSafeOutbound } from "./safe-outbound-fetch";

export type ImageReferenceReadContext = { ownerUserId: string; taskId: string };

export function imageReferenceHttpError(status: number) {
    const reason = status === 401 ? "登录凭证已失效" : status === 403 ? "无权读取" : status === 404 ? "文件不存在或已过期" : status === 429 ? "媒体读取受到限流，请稍后重试" : "存储服务读取失败";
    return new Error(`参考图读取失败（HTTP ${status}）：${reason}`);
}

export async function readManagedImageReference(value: string, origin: string, context: ImageReferenceReadContext | undefined, maxBytes: number, timeoutMs: number) {
    if (!context) return null;
    const url = new URL(value, origin);
    const trustedOrigins = [origin, process.env.NEXT_PUBLIC_SITE_URL].filter(Boolean).map((value) => new URL(value!).origin);
    const scope = url.pathname.startsWith("/api/reference-assets/") ? "reference" : url.pathname.startsWith("/api/generation-log-assets/") ? "generation" : null;
    if (!scope || !trustedOrigins.includes(url.origin)) return null;
    const prefix = scope === "reference" ? "/api/reference-assets/" : "/api/generation-log-assets/";
    const storageKey = decodeURIComponent(url.pathname.slice(prefix.length));
    try {
        const registration = await getLocalMediaRegistration(storageKey);
        if (!registration || registration.scope !== scope || registration.type !== "image" || isLocalMediaRegistrationExpired(registration) || registration.ownerUserId !== context.ownerUserId) {
            throw new Error("参考图不存在、已过期或无权读取");
        }
        if (registration.bytes > maxBytes) throw new Error("参考图过大，请压缩后重试");
        let bytes: Buffer;
        if (registration.storageProvider === "object") {
            // Read the registered original even when external storage is now disabled.
            const source = await createExternalMediaReadUrl(new Request(new URL(url.pathname, origin)), registration);
            if (!source) throw new Error("参考图外部存储源文件不可用");
            const response = await fetchSafeOutbound(source, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
            if (!response.ok) {
                await response.body?.cancel();
                throw imageReferenceHttpError(response.status);
            }
            if (Number(response.headers.get("content-length") || 0) > maxBytes) {
                await response.body?.cancel();
                throw new Error("参考图过大，请压缩后重试");
            }
            bytes = Buffer.from(await new Response(limitMediaResponseBody(response.body, maxBytes, timeoutMs)).arrayBuffer());
        } else {
            const root = resolve(getServerDataDir(), scope === "reference" ? "reference-assets" : "generation-assets");
            const filePath = resolve(root, storageKey);
            if (!filePath.startsWith(root + sep)) throw new Error("参考图地址无效");
            const info = await stat(filePath);
            if (!info.isFile()) throw new Error("参考图源文件不存在");
            if (info.size > maxBytes) throw new Error("参考图过大，请压缩后重试");
            bytes = await readFile(filePath);
        }
        if (!bytes.length) throw new Error("参考图源文件内容为空");
        if (bytes.length > maxBytes) throw new Error("参考图过大，请压缩后重试");
        return { bytes, mimeType: registration.mimeType };
    } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
        const message =
            code === "ENOENT"
                ? "参考图源文件不存在（存储登记仍存在）"
                : code
                  ? "参考图存储读取失败，请联系管理员"
                  : error instanceof Error && error.message === "Media is too large"
                    ? "参考图过大，请压缩后重试"
                    : toSafeGenerationErrorMessage(error, "参考图存储读取失败");
        console.error("Managed image reference read failed", { taskId: context.taskId, storageKey, scope, code, reason: message });
        throw new Error(message, { cause: error });
    }
}
