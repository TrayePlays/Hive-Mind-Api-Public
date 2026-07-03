import { HivemindAPI } from "./api";
import "./usage/httpExample"
import "./usage/saveBuild"

export const api = new HivemindAPI("BuildSaver", { scriptEvent: true });