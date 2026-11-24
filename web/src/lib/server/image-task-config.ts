export function resolveImageTaskOptions(config: { quality?: unknown; resolution?: unknown; size?: unknown; outputBackground?: unknown; outputMode?: unknown }, defaults: { imageQuality: string; imageResolution: string; imageSize: string }) {
    return {
        quality: text(config.quality) || defaults.imageQuality,
        resolution: text(config.resolution) || defaults.imageResolution,
        size: text(config.size) || defaults.imageSize,
        ...(config.outputBackground === "transparent" ? { outputBackground: "transparent" as const } : {}),
        ...(config.outputMode === "layers" ? { outputMode: "layers" as const } : {}),
    };
}

export function resolveImageGenerationCount(value: unknown) {
    const count = Number(value);
    return Math.max(1, Number.isSafeInteger(count) && count > 0 ? Math.floor(count) : 1);
}

function text(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}
