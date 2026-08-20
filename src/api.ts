import { CommandPermissionLevel, CustomCommandOrigin, CustomCommandParamType, system, world, CustomCommandResult, CustomCommandStatus, CustomCommand, CustomCommandSource } from "@minecraft/server";

const VERSION = 0.5;

export interface Request {
    type: RequestTypes
    apiName: string
    id: string
    data: RequestData
    scriptEvent: boolean
}

export type RequestData = HttpRequestData | {}

export interface HttpRequestData {
    /**
     * @remarks The URI you want to pull the data from.
     */
    uri: string
    /**
     * @remarks You can define the type of request and other data you want to set here.
     */
    init?: RequestInit
    /**
     * @remarks Extra data you can include with the request.
     */
    extraInfo?: ExtraHttpRequestInfo
}

export interface ExtraHttpRequestInfo {
    crop?: { left: number, top: number, width: number, height: number };
}

/**
 * Soon to add more request types!
 */
export enum RequestTypes {
    HttpRequest = "httpRequest",
    MidiRequest = "midiRequest"
}

export interface ServerResponse {
    status: ServerStatusResponse
    getData: () => any
    data: string
    message?: string
}

export enum ServerStatusResponse {
    Running = -2,
    Ran = -1,
    Success = 0,
    Failure = 1
}

export enum SetActions {
    Set = "set",
    Reset = "reset",
    Add = "add",
    Get = "get",
    Remove = "remove"
}

interface HiveMindAPISettings {
    namespace?: string,
    scriptEvent?: boolean
    logFailures?: boolean,
    onConnect?: () => void,
}

export class HivemindAPI {
    readonly apiName: string;
    readonly namespace: string;
    private onConnect?: () => void;
    private pendingRequests: Map<string, {
        callback: (response: ServerResponse, done?: boolean) => void;
        onProgress?: (chunk: number, totalChunks: number) => void;
        totalChunks?: number;
        receivedChunks?: number;
    }>;
    private responses: Map<string, any>;
    private scriptEvent: boolean;
    private logFailures: boolean;
    private loadTick: number;
    /**
     * @remarks If your project has a namespace, you will need to define it in the settings for the functions to properly work. 
     * Requests may fail if you set nametag every tick. Settings for player list is who the request runs as.
     * They need to be connected to Hive Mind Servers for it to work!
     * 
     * @warn Namespace MUST have no spaces!!!
     */
    constructor(apiName: string, settings: HiveMindAPISettings = { namespace: "hivemind", scriptEvent: true, logFailures: true, onConnect: undefined }) {
        if (settings.logFailures === undefined) settings.logFailures = true;
        if (settings.namespace === undefined) settings.namespace = "hivemind";
        if (settings.scriptEvent === undefined) settings.scriptEvent = true;
        this.logFailures = settings.logFailures;
        this.scriptEvent = settings.scriptEvent;
        this.pendingRequests = new Map();
        this.responses = new Map<string, any>();
        this.apiName = apiName;
        this.namespace = settings.namespace;
        this.setupListeners();
        this.initSetup();
        this.onConnect = settings.onConnect;
        this.loadTick = system.currentTick;
    }

    private initSetup() {
        system.run(() => {
            //removes all old requests
            for (const dp of world.getDynamicPropertyIds().filter(dp => dp.startsWith("hivemindRequest"))) {
                world.setDynamicProperty(dp);
            }
            world.setDynamicProperty(`hivemindResponse`, JSON.stringify({
                version: VERSION,
                name: this.apiName,
                scriptEvent: this.scriptEvent
            }));
        })
    }

    private setupListeners() {
        const name = this.apiName;
        const logFailures = this.logFailures;
        const responses = this.responses;
        const pendingRequests = this.pendingRequests;
        const scriptEvent = this.scriptEvent;
        if (scriptEvent) {
            system.afterEvents.scriptEventReceive.subscribe(({ id, message, sourceEntity }) => {
                const origin = { sourceEntity, sourceType: CustomCommandSource.Entity };
                const args = message.split(" ");
                if (id === "hivemind:purpose") purposeCMD(origin);
                if (id === "hivemind:hivemind") hivemindCMD(origin);
                if (id === "hivemind:respond") respondCMD(origin, message);
                if (id === "hivemind:set") setCMD(origin, args[0] as SetActions, args[1], message.slice(args[0].length + args[1].length + 2));
            })
        } else {
            system.beforeEvents.startup.subscribe(({ customCommandRegistry }) => {
                const purpose: CustomCommand = {
                    name: `${this.namespace}:purpose`,
                    description: "Checks purpose and name (FOR API)",
                    permissionLevel: CommandPermissionLevel.Admin
                };

                const hivemind: CustomCommand = {
                    name: `${this.namespace}:hivemind`,
                    description: "Checks version of hivemind (FOR API)",
                    permissionLevel: CommandPermissionLevel.Admin
                };

                const respond: CustomCommand = {
                    name: `${this.namespace}:respond`,
                    description: "Sets a response for data requested (FOR API)",
                    permissionLevel: CommandPermissionLevel.Admin,
                    mandatoryParameters: [
                        { name: "response", type: CustomCommandParamType.String }
                    ]
                };

                const set: CustomCommand = {
                    name: `${this.namespace}:set`,
                    description: "Sets data on a property (FOR API)",
                    permissionLevel: CommandPermissionLevel.Admin,
                    mandatoryParameters: [
                        //Setting it to name because stable apis
                        { name: `${this.namespace}:setActions`, type: CustomCommandParamType.Enum, enumName: `${this.namespace}:setActions` },
                        { name: "requestId", type: CustomCommandParamType.String }
                    ],
                    optionalParameters: [
                        { name: "rawData", type: CustomCommandParamType.String }
                    ]
                };

                customCommandRegistry.registerEnum(`${this.namespace}:setActions`, Object.values(SetActions));
                customCommandRegistry.registerCommand(purpose, purposeCMD);
                customCommandRegistry.registerCommand(hivemind, hivemindCMD);
                customCommandRegistry.registerCommand(respond, respondCMD);
                customCommandRegistry.registerCommand(set, setCMD);
            })
        }
        // Had to change this to a const for the this parameter.
        const purposeCMD = (origin: CustomCommandOrigin): CustomCommandResult => {
            const connect = this.onConnect
            world.setDynamicProperty(`hivemindResponse`, JSON.stringify({
                version: VERSION,
                name,
                scriptEvent
            }));
            if (connect) {
                connect();
            }
            return { status: CustomCommandStatus.Success };
        }

        function hivemindCMD(origin: CustomCommandOrigin): CustomCommandResult {
            return { status: CustomCommandStatus.Success, message: `Hive Mind API is on version ${VERSION}` };
        }

        function respondCMD(origin: CustomCommandOrigin, response: string): CustomCommandResult {
            const [id, statusStr, message, data] = response.split("|");
            const status = parseInt(statusStr);
            let realData: any
            const resolver = pendingRequests.get(id)?.callback;
            let requestedData = responses.get(id);
            if (status == ServerStatusResponse.Ran) {
                try {
                    requestedData = JSON.parse(requestedData);
                    if (scriptEvent) requestedData = JSON.parse(requestedData)
                } catch { }
                if (resolver) {
                    const chunks = world?.getDynamicProperty(`hivemindRequest${id}|meta`) as number ?? 0
                    for (let i = 0; i < chunks; i++) {
                        world.setDynamicProperty(`hivemindRequest${id}|${i}`)
                    }
                    world.setDynamicProperty(`hivemindRequest${id}|meta`)
                    resolver({
                        status,
                        message: message || undefined,
                        data: requestedData ?? data,
                        getData: () => { }
                    }, false);
                }
            }
            else if (status == ServerStatusResponse.Failure) {
                let realReq = id;
                if (!id) {
                    realReq = Array.from(pendingRequests.keys()).pop() as string;
                }
                const resolver = pendingRequests.get(realReq)?.callback;
                if (resolver) {
                    resolver({
                        status,
                        message: message || undefined,
                        data: data || "",
                        getData: () => { }
                    }, true);
                    if (logFailures) {
                        console.warn(new Error(message));
                    }
                }
            } else if (status == ServerStatusResponse.Running) {
                const pending = pendingRequests.get(id);

                if (pending) {
                    const json: { totalChunks: number } = JSON.parse(data)

                    pending.totalChunks = json.totalChunks;
                    pending.receivedChunks = 0;
                }
            } else {
                try {
                    realData = JSON.parse(requestedData);
                } catch { }
                if (resolver) {
                    resolver({
                        status,
                        message: message || undefined,
                        data: requestedData ?? data,
                        getData() {
                            return realData;
                        }
                    }, true);
                }
            }
            return { status: CustomCommandStatus.Success };
        }

        function setCMD(origin: CustomCommandOrigin, setAction: SetActions, requestId: string, rawData: string): CustomCommandResult {
            if (setAction === SetActions.Add) {
                let raw = responses.get(requestId) as string ?? "";
                raw += rawData;
                responses.set(requestId, raw);
                const pending = pendingRequests.get(requestId);

                if (pending?.onProgress) {
                    pending.receivedChunks = (pending.receivedChunks ?? 0) + 1;
                    pending.onProgress(pending.receivedChunks, pending.totalChunks ?? 0);
                }
            }
            if (setAction === SetActions.Remove) {
                const chunks = world?.getDynamicProperty(`hivemindRequest${requestId}|meta`) as number ?? 0
                for (let i = 0; i < chunks; i++) {
                    world.setDynamicProperty(`hivemindRequest${requestId}|${i}`)
                }
                world.setDynamicProperty(`hivemindRequest${requestId}|meta`)
                // Works with old version too
                world.setDynamicProperty(rawData);
            }
            if (setAction == SetActions.Reset) {
                responses.delete(requestId)
            }
            if (setAction === SetActions.Get) {
                return { status: CustomCommandStatus.Success, message: `${responses.get(requestId)}` };
            }
            if (setAction === SetActions.Set) {
                responses.set(requestId, rawData)
            }
            return { status: CustomCommandStatus.Success };
        }
    }
    /**
     * @remarks Splits up string to the max limit Minecraft can handle in a dynamic property
     */
    private splitString(str: string, size = 32767): string[] {
        const chunks = [];
        for (let i = 0; i < str.length; i += size) {
            chunks.push(str.substring(i, i + size));
        }
        return chunks;
    }
    /**
     * @remarks Sends a request with the raw data you give it and returns a response. Runs for each in the player list (defaults to only hosts).
     */
    private async sendRequestAsync(data: Request, timeoutTicks = 50, onProgress?: (chunk: number, totalChunks: number) => void): Promise<ServerResponse> {
        return new Promise<ServerResponse>((resolve, reject) => {
            if (system.currentTick == this.loadTick) return reject(new Error("You can't run this in a system.run do 2 system.runs or run another way."))
            if (!data.id) return reject(new Error("No request ID!"));
            if (!data.type) return reject(new Error("No request type!"));

            const id = data.id;

            const json = JSON.stringify(data);
            const chunks = this.splitString(json);
            world.setDynamicProperty(`hivemindRequest${id}|meta`, chunks.length);

            for (let i = 0; i < chunks.length; i++) {
                world.setDynamicProperty(`hivemindRequest${id}|${i}`, chunks[i]);
            }

            const timeout = system.runTimeout(() => {
                world.setDynamicProperty(`hivemindRequest${id}|meta`);

                for (let i = 0; i < chunks.length; i++) {
                    world.setDynamicProperty(`hivemindRequest${id}|${i}`);
                }
                this.pendingRequests.delete(id);
                console.warn("Timed out on waiting for server response. Make sure you are connected: /script debugger connect traye.ddns.net")
                resolve({ status: ServerStatusResponse.Failure, message: "Timed out" } as ServerResponse);
            }, timeoutTicks);


            this.pendingRequests.set(id, {
                callback: (response, done) => {
                    system.clearRun(timeout);
                    if (done) {
                        this.pendingRequests.delete(id);
                        resolve(response);
                        this.responses.delete(id);
                    }
                },
                onProgress
            });
        });
    }
    private id() {
        return Date.now() + ":" + this.apiName;
    }
    private buildRequest(type: RequestTypes, data: RequestData = {}) {
        return {
            id: this.id(),
            type,
            apiName: this.apiName,
            scriptEvent: this.scriptEvent,
            data
        } as Request;
    }
    /**
     *  @remarks Sends a fetch request to a uri.
     */
    async sendHttpRequest(uri: string, init?: RequestInit, extraInfo?: ExtraHttpRequestInfo, timeoutTicks = 50, onProgress?: (chunk: number, totalChunks: number) => void) {
        return await this.sendRequestAsync(this.buildRequest(RequestTypes.HttpRequest, { uri, init, extraInfo }), timeoutTicks, onProgress);
    }
    async sendMidiRequest(uri: string, extraInfo?: ExtraHttpRequestInfo, timeoutTicks = 50, onProgress?: (chunk: number, totalChunks: number) => void) {
        return await this.sendRequestAsync(this.buildRequest(RequestTypes.MidiRequest, { uri, extraInfo }), timeoutTicks, onProgress);
    }
}