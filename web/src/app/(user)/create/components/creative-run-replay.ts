import type { CreativeGenerationPreferences } from "@/lib/creative-runtime-contract";
import type { CreativeAgentRun } from "@/services/api/creative";

export function creativeRunReplayPreferences(run?: CreativeAgentRun): CreativeGenerationPreferences | undefined {
    if (!run) return undefined;
    const preferences = run.generationPreferences;
    const counts = (type: "image" | "video") =>
        run.tasks
            .filter((task) => task.type === type)
            .map((task) => Number(task.count))
            .filter((count) => Number.isInteger(count) && count > 0);
    const imageCounts = counts("image");
    const videoCounts = counts("video");
    const imageResolution = run.tasks.find((task) => task.type === "image")?.resolution;
    if (!imageCounts.length && !videoCounts.length) return preferences;
    return {
        ...preferences,
        ...(imageCounts.length ? { image: { ...preferences?.image, ...(imageResolution ? { resolution: imageResolution } : {}), count: Math.max(...imageCounts) } } : {}),
        ...(videoCounts.length ? { video: { ...preferences?.video, count: Math.max(...videoCounts) } } : {}),
    };
}
