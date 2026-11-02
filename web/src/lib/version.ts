export function compareVersions(leftVersion: string, rightVersion: string) {
    const left = parseVersion(leftVersion);
    const right = parseVersion(rightVersion);
    if (!left || !right) return 0;

    for (let index = 0; index < left.core.length; index += 1) {
        if (left.core[index] !== right.core[index]) return left.core[index] - right.core[index];
    }

    if (!left.prerelease.length || !right.prerelease.length) {
        if (left.prerelease.length === right.prerelease.length) return 0;
        return left.prerelease.length ? -1 : 1;
    }

    for (let index = 0; index < Math.max(left.prerelease.length, right.prerelease.length); index += 1) {
        const leftPart = left.prerelease[index];
        const rightPart = right.prerelease[index];
        if (leftPart === undefined) return -1;
        if (rightPart === undefined) return 1;
        if (leftPart === rightPart) continue;

        const leftNumeric = /^\d+$/.test(leftPart);
        const rightNumeric = /^\d+$/.test(rightPart);
        if (leftNumeric && rightNumeric) {
            if (leftPart.length !== rightPart.length) return leftPart.length - rightPart.length;
            return leftPart < rightPart ? -1 : 1;
        }
        if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
        return leftPart < rightPart ? -1 : 1;
    }

    return 0;
}

function parseVersion(version: string) {
    const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/);
    if (!match) return null;
    return {
        core: match.slice(1, 4).map(Number),
        prerelease: match[4]?.split(".") ?? [],
    };
}
