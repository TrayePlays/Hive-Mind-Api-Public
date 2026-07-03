import { Dimension, GameMode, Player, system, Vector3, world } from "@minecraft/server";
import { api } from "../index";
import { ServerStatusResponse } from "../api";

const buildMap = new Map<string, SavedStructure>();

world.beforeEvents.playerBreakBlock.subscribe((data) => {
    const { block, itemStack, player } = data
    if (itemStack?.typeId == "minecraft:diamond_axe" && player.getGameMode() == GameMode.Creative) {
        system.run(() => player.sendMessage(`Pos1 Set`))
        player.setDynamicProperty(`saveLocation1`, block.location)
        data.cancel = true;
    }
})

world.beforeEvents.playerInteractWithBlock.subscribe((data) => {
    const { block, itemStack, player, isFirstEvent } = data
    if (itemStack?.typeId == "minecraft:diamond_axe" && player.getGameMode() == GameMode.Creative && isFirstEvent) {
        system.run(() => player.sendMessage(`Pos2 Set`))
        player.setDynamicProperty(`saveLocation2`, block.location)
        data.cancel = true;
    }
})

system.afterEvents.scriptEventReceive.subscribe(async ({ id, message, sourceEntity }) => {
    if (!sourceEntity || sourceEntity.typeId != "minecraft:player") return;
    const player = sourceEntity as Player;
    if (id == "hivemind:save") {
        const pos1 = player.getDynamicProperty("saveLocation1") as Vector3 | undefined;
        const pos2 = player.getDynamicProperty("saveLocation2") as Vector3 | undefined;

        if (!pos1 || !pos2) return player.sendMessage(`One of your locations are unset!`);
        console.warn(`Saving Locally...`)
        runSaveStructure(player.dimension, pos1, pos2, async (structure) => {
            buildMap.set(message, structure);
            console.warn(`Saved Locally`)
            console.warn(`Saving Online...`)
            // If you are sharing publicly don't share key like this:
            const saveReq = await api.sendHttpRequest(`https://minecraft-builds-47827-default-rtdb.firebaseio.com/build/${message}.json?auth=RKFKTuBT8FMsjBFYgn1FXXYod1g9XNyVlPoamf3S`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(structure),
            })
            console.warn(`${saveReq.status == ServerStatusResponse.Success ? "" : "Failed to "}Save${saveReq.status == ServerStatusResponse.Success ? "d" : ""} Online`)
        });
    }
    if (id == "hivemind:load") {
        console.warn(`Checking for build online...`)
        const buildReq = await api.sendHttpRequest(`https://minecraft-builds-47827-default-rtdb.firebaseio.com/build/${message}.json?auth=RKFKTuBT8FMsjBFYgn1FXXYod1g9XNyVlPoamf3S`)
        if (buildReq.status == ServerStatusResponse.Success) {
            console.warn(`Found build online, placing...`)
            const structure = buildReq.getData() as SavedStructure;
            console.warn(structure);
            runPlaceStructure(structure, player.dimension, player.location);
            return;
        } else {
            console.warn(`No build online found!`)
            console.warn(`Checking for build locally...`)
            if (!buildMap.has(message)) return console.warn(`This structure doesn't exist!`);
            const structure = buildMap.get(message);
            runPlaceStructure(structure, player.dimension, player.location);
        }
    }
})

function getSelectionBounds(pos1: Vector3, pos2: Vector3, add = 0) {
    return {
        minX: Math.min(pos1.x, pos2.x),
        maxX: Math.max(pos1.x, pos2.x) + add,

        minY: Math.min(pos1.y, pos2.y),
        maxY: Math.max(pos1.y, pos2.y) + add,

        minZ: Math.min(pos1.z, pos2.z),
        maxZ: Math.max(pos1.z, pos2.z) + add,
    };
}

function drawSelection(dimension: Dimension, pos1: Vector3, pos2: Vector3) {
    const b = getSelectionBounds(pos1, pos2, 1);
    try {
        for (let x = b.minX; x <= b.maxX; x++) {
            dimension.spawnParticle("minecraft:endrod", { x: x, y: b.minY, z: b.minZ });
            dimension.spawnParticle("minecraft:endrod", { x: x, y: b.minY, z: b.maxZ });
            dimension.spawnParticle("minecraft:endrod", { x: x, y: b.maxY, z: b.minZ });
            dimension.spawnParticle("minecraft:endrod", { x: x, y: b.maxY, z: b.maxZ });
        }

        for (let z = b.minZ; z <= b.maxZ; z++) {
            dimension.spawnParticle("minecraft:endrod", { x: b.minX, y: b.minY, z: z });
            dimension.spawnParticle("minecraft:endrod", { x: b.maxX, y: b.minY, z: z });
            dimension.spawnParticle("minecraft:endrod", { x: b.minX, y: b.maxY, z: z });
            dimension.spawnParticle("minecraft:endrod", { x: b.maxX, y: b.maxY, z: z });
        }

        for (let y = b.minY; y <= b.maxY; y++) {
            dimension.spawnParticle("minecraft:endrod", { x: b.minX, y: y, z: b.minZ });
            dimension.spawnParticle("minecraft:endrod", { x: b.maxX, y: y, z: b.minZ });
            dimension.spawnParticle("minecraft:endrod", { x: b.minX, y: y, z: b.maxZ });
            dimension.spawnParticle("minecraft:endrod", { x: b.maxX, y: y, z: b.maxZ });
        }
    } catch { }
}

system.runInterval(() => {
    for (const player of world.getPlayers()) {
        const pos1 = player.getDynamicProperty("saveLocation1") as Vector3 | undefined;
        const pos2 = player.getDynamicProperty("saveLocation2") as Vector3 | undefined;

        if (!pos1 || !pos2) continue;

        drawSelection(player.dimension, pos1, pos2);
    }
}, 20);

interface SavedStructure {
    size: Vector3;
    palette: string[];
    blocks: number[];
}

function runSaveStructure(dimension: Dimension, pos1: Vector3, pos2: Vector3, onDone?: (structure: SavedStructure) => void) {
    system.runJob(saveStructure(dimension, pos1, pos2, onDone))
}

function* saveStructure(dimension: Dimension, pos1: Vector3, pos2: Vector3, onDone?: (structure: SavedStructure) => void): Generator<void, void, void> {
    const { maxX, maxY, maxZ, minX, minY, minZ } = getSelectionBounds(pos1, pos2)
    if (world.tickingAreaManager.getTickingArea("saveStructure")) {
        world.tickingAreaManager.removeTickingArea("saveStructure")
    }

    const palette: string[] = [];
    const blocks: number[] = [];

    let x = minX;
    let y = minY;
    let z = minZ;

    let waitingForChunk = false;

    while (y <= maxY) {
        while (z <= maxZ) {
            while (x <= maxX) {
                if (!dimension.isChunkLoaded({ x, y, z })) {
                    waitingForChunk = true;
                    try {
                        world.tickingAreaManager.createTickingArea("saveStructure", { dimension, from: { x: minX, y: minY, z: minZ }, to: { x: maxX, y: maxY, z: maxZ } }).then(() => {
                            waitingForChunk = false;
                        });
                    } catch { };

                    yield;
                    continue;
                }
                const block = dimension.getBlock({ x, y, z });

                if (!block) {
                    blocks.push(0);
                } else {
                    let index = palette.indexOf(block.typeId);

                    if (index === -1) {
                        palette.push(block.typeId);
                        index = palette.length - 1;
                    }

                    blocks.push(index);
                }
                x++;

                if (blocks.length % 500 === 0) {
                    yield;
                }
            }
            x = minX;
            z++;
            yield;
        }
        z = minZ;
        y++;
        yield;
    }

    const result: SavedStructure = {
        size: {
            x: maxX - minX + 1,
            y: maxY - minY + 1,
            z: maxZ - minZ + 1
        },
        palette,
        blocks
    };

    if (world.tickingAreaManager.getTickingArea("saveStructure")) {
        world.tickingAreaManager.removeTickingArea("saveStructure")
    }

    if (onDone) onDone(result);
}

function runPlaceStructure(structure: SavedStructure, dimension: Dimension, location: Vector3) {
    system.runJob(placeStructure(structure, dimension, location))
}

function* placeStructure(structure: SavedStructure, dimension: Dimension, location: Vector3) {
    if (world.tickingAreaManager.getTickingArea("placeStructure")) {
        world.tickingAreaManager.removeTickingArea("placeStructure")
    }
    let i = 0;

    const minX = location.x;
    const minY = location.y;
    const minZ = location.z;

    const maxX = location.x + structure.size.x;
    const maxY = location.y + structure.size.y;
    const maxZ = location.z + structure.size.z;

    let tickingAreaCreated = false;

    for (let y = 0; y < structure.size.y; y++) {
        for (let z = 0; z < structure.size.z; z++) {
            for (let x = 0; x < structure.size.x; x++) {

                const worldX = location.x + x;
                const worldY = location.y + y;
                const worldZ = location.z + z;

                if (!dimension.isChunkLoaded({ x: worldX, y: worldY, z: worldZ })) {

                    if (!tickingAreaCreated) {
                        try {
                            world.tickingAreaManager.createTickingArea("placeStructure", { dimension, from: { x: minX, y: minY, z: minZ }, to: { x: maxX, y: maxY, z: maxZ } }).then(() => {
                                tickingAreaCreated = true;
                            });
                        } catch { }
                    }

                    while (!dimension.isChunkLoaded({ x: worldX, y: worldY, z: worldZ })) {
                        yield;
                    }
                }

                const paletteIndex = structure.blocks[i++];
                const blockId = structure.palette[paletteIndex];

                const block = dimension.getBlock({ x: worldX, y: worldY, z: worldZ });

                if (!block) {
                    yield;
                    continue;
                }

                block.setType(blockId);

                if (i % 500 === 0) {
                    yield;
                }
            }
        }
    }
    if (world.tickingAreaManager.getTickingArea("placeStructure")) {
        world.tickingAreaManager.removeTickingArea("placeStructure")
    }
}