import { world } from "@minecraft/server";
import { HivemindAPI } from "./api";

import "./usage/httpExample"
import "./usage/saveBuild"

// You should change the name to one with no spaces
export const api = new HivemindAPI("<Your Mod / Name>", { scriptEvent: true, onConnect: () => initialConnect() });

function initialConnect() {
    world.sendMessage("Connected to Hive Mind API!")
}