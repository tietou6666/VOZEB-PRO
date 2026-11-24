"use client";

import { SlidersHorizontal } from "lucide-react";

import { CreativeGenerationPreferences, generationPreferenceSummary, type CreativeGenerationPreferencePatch } from "@/components/creative-generation-preferences";
import type { CreativeGenerationPreferences as GenerationPreferences } from "@/lib/creative-runtime-contract";
import type { AiConfig } from "@/stores/use-config-store";
import { useCreativeComposerPopoverPlacement, type CreativeComposerPopoverPlacement } from "@/components/creative-composer-popover";
import { canvasModelCapabilityProfile } from "../utils/canvas-model-capabilities";

type CanvasImageSettingsPopoverProps = {
    config: AiConfig;
    onConfigChange: (key: keyof AiConfig, value: string) => void;
    onOpenChange?: (open: boolean) => void;
    buttonClassName?: string;
    placement?: CreativeComposerPopoverPlacement;
    fixedSizeLabel?: string;
};

export function CanvasImageSettingsPopover({ config, onConfigChange, onOpenChange, buttonClassName, placement = "topLeft", fixedSizeLabel }: CanvasImageSettingsPopoverProps) {
    const responsivePlacement = useCreativeComposerPopoverPlacement(placement);
    const preferences: GenerationPreferences = {
        mode: "image",
        image: {
            size: config.size || "auto",
            quality: imageQuality(config.quality),
            resolution: config.resolution || "1K",
            count: positiveInteger(config.count),
        },
    };
    const summary = canvasImagePreferenceSummary(preferences, fixedSizeLabel);
    const fullSummary = generationPreferenceSummary("image", preferences);

    return (
        <CreativeGenerationPreferences
            capability="image"
            preferences={preferences}
            capabilityProfile={canvasModelCapabilityProfile(config)}
            triggerLabel={summary}
            triggerAriaLabel={`图片设置：${fullSummary}`}
            triggerIcon={<SlidersHorizontal className="size-4" />}
            triggerClassName={buttonClassName}
            triggerLabelClassName="whitespace-nowrap text-left !overflow-visible !text-clip"
            placement={responsivePlacement}
            autoAdjustOverflow
            fixedSizeLabel={fixedSizeLabel}
            onOpenChange={onOpenChange}
            onChange={(patch) => applyImagePreferencePatch(patch, onConfigChange)}
        />
    );
}

export function canvasImagePreferenceSummary(preferences: GenerationPreferences, fixedSizeLabel?: string) {
    const image = preferences.image;
    const size = fixedSizeLabel || compactSizeLabel(image?.size);
    const resolution = image?.resolution || "1K";
    const quality = ({ auto: "智能", high: "高强度", medium: "中强度", low: "低强度" } as Record<string, string>)[image?.quality || "auto"] || image?.quality || "智能";
    const count = image?.count || 1;
    return `${resolution} · ${size} · ${quality}${count > 1 ? ` · ${count}份` : ""}`;
}

function applyImagePreferencePatch(patch: CreativeGenerationPreferencePatch, onChange: (key: keyof AiConfig, value: string) => void) {
    if (patch.size !== undefined) onChange("size", patch.size);
    if (patch.quality !== undefined) onChange("quality", patch.quality);
    if (patch.resolution !== undefined) onChange("resolution", patch.resolution);
    if (patch.count !== undefined) onChange("count", String(patch.count));
}

function imageQuality(value?: string): NonNullable<GenerationPreferences["image"]>["quality"] {
    return value?.trim() || "auto";
}

function positiveInteger(value: unknown) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

function compactSizeLabel(value?: string) {
    return !value || value === "auto" ? "智能" : value.replace("x", "×");
}
