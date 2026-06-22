import { CommandPermissionLevel, CustomCommandOrigin, CustomCommandParamType, system, world, CustomCommandResult, CustomCommandStatus, CustomCommand, CustomCommandSource } from "@minecraft/server";

const VERSION = 0.2;

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
}

/**
 * Soon to add more request types!
 */
export enum RequestTypes {
    HttpRequest = "httpRequest",
}

export interface ServerResponse {
    status: ServerStatusResponse
    getData?: () => any
    data?: string
    message?: string
}

export enum ServerStatusResponse {
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
    logFailures?: boolean
}

export class HivemindAPI {
    readonly apiName: string;
    readonly namespace: string;
    private pendingRequests: Map<string, (response: ServerResponse, done?: boolean) => void>;
    private responses: Map<string, any>;
    private scriptEvent: boolean;
    private logFailures: boolean;

    /**
     * @remarks If your project has a namespace, you will need to define it in the settings for the functions to properly work. 
     * Requests may fail if you set nametag every tick. Settings for player list is who the request runs as.
     * They need to be connected to Hive Mind Servers for it to work!
     * 
     * @warn Namespace MUST have no spaces!!!
     */
    constructor(apiName: string, settings: HiveMindAPISettings = { namespace: "hivemind", scriptEvent: true, logFailures: true }) {
        if (settings.logFailures == undefined) settings.logFailures = true;
        if (settings.namespace == undefined) settings.namespace = "hivemind";
        if (settings.scriptEvent == undefined) settings.scriptEvent = true;
        this.logFailures = settings.logFailures;
        this.scriptEvent = settings.scriptEvent;
        this.pendingRequests = new Map<string, (response: ServerResponse, done?: boolean) => void>();
        this.responses = new Map<string, any>();
        this.apiName = apiName;
        this.namespace = settings.namespace;
        this.setupListeners();
        this.initSetup();
    }
    private initSetup() {
        system.run(() => {
            //removes all old requests
            for (const dp of world.getDynamicPropertyIds().filter(dp => dp.startsWith("hivemindRequest"))) {
                world.setDynamicProperty(dp)
            }
            world.setDynamicProperty(`hivemindResponse`, JSON.stringify({
                version: VERSION,
                name: this.apiName,
                scriptEvent: this.scriptEvent
            }));
        })
    }
    private setupListeners() {
        const name = this.apiName
        const logFailures = this.logFailures;
        const responses = this.responses;
        const pendingRequests = this.pendingRequests;
        const scriptEvent = this.scriptEvent;

        if (scriptEvent) {
            system.afterEvents.scriptEventReceive.subscribe(({ id, message, sourceEntity }) => {
                const origin = { sourceEntity, sourceType: CustomCommandSource.Entity }
                const args = message.split(" ")
                if (id == "hivemind:purpose") {
                    purposeCMD(origin)
                }
                if (id == "hivemind:hivemind") {
                    hivemindCMD(origin);
                }
                if (id == "hivemind:respond") {
                    respondCMD(origin, message);
                }
                if (id == "hivemind:set") {
                    setCMD(origin, args[0] as SetActions, args[1], message.slice(args[0].length + args[1].length + 2));
                }
            })
        } else {
            system.beforeEvents.startup.subscribe(({ customCommandRegistry }) => {
                const purpose: CustomCommand = {
                    name: `${this.namespace}:purpose`,
                    description: "Checks purpose and name (FOR API)",
                    permissionLevel: CommandPermissionLevel.Admin
                }

                const hivemind: CustomCommand = {
                    name: `${this.namespace}:hivemind`,
                    description: "Checks version of hivemind (FOR API)",
                    permissionLevel: CommandPermissionLevel.Admin
                }

                const respond: CustomCommand = {
                    name: `${this.namespace}:respond`,
                    description: "Sets a response for data requested (FOR API)",
                    permissionLevel: CommandPermissionLevel.Admin,
                    mandatoryParameters: [
                        { name: "response", type: CustomCommandParamType.String }
                    ]
                }

                const set: CustomCommand = {
                    name: `${this.namespace}:set`,
                    description: "Sets data on a property (FOR API)",
                    permissionLevel: CommandPermissionLevel.Admin,
                    mandatoryParameters: [
                        //Setting it to name because stable apis
                        { name: `${this.namespace}:setActions`, type: CustomCommandParamType.Enum, enumName: `${this.namespace}:setActions` },
                        { name: "requestId", type: CustomCommandParamType.String },
                    ],
                    optionalParameters: [
                        { name: "rawData", type: CustomCommandParamType.String }
                    ]
                }

                customCommandRegistry.registerEnum(`${this.namespace}:setActions`, Object.values(SetActions))
                customCommandRegistry.registerCommand(purpose, purposeCMD)
                customCommandRegistry.registerCommand(hivemind, hivemindCMD)
                customCommandRegistry.registerCommand(respond, respondCMD)
                customCommandRegistry.registerCommand(set, setCMD)
            })
        }
        function purposeCMD(origin: CustomCommandOrigin): CustomCommandResult {
            world.setDynamicProperty(`hivemindResponse`, JSON.stringify({
                version: VERSION,
                name,
                scriptEvent
            }));
            return { status: CustomCommandStatus.Success };
        }

        function hivemindCMD(origin: CustomCommandOrigin): CustomCommandResult {
            return { status: CustomCommandStatus.Success, message: `Hive Mind API is on version ${VERSION}` };
        }

        function respondCMD(origin: CustomCommandOrigin, response: string): CustomCommandResult {
            const [id, statusStr, message, data] = response.split("|");
            const status = parseInt(statusStr);
            if (status == ServerStatusResponse.Ran) {
                const resolver = pendingRequests.get(id);
                let requestedData = responses.get(id);
                try {
                    requestedData = JSON.parse(requestedData);
                    if (scriptEvent) requestedData = JSON.parse(requestedData)
                } catch { }
                if (resolver) {
                    world.setDynamicProperty(`hivemindRequest${id}`)
                    resolver({
                        status,
                        message: message || undefined,
                        data: requestedData ?? data
                    }, false);
                }
            }
            else if (status == ServerStatusResponse.Failure) {
                let realReq = id;
                if (!id) {
                    realReq = Array.from(pendingRequests.keys()).pop() as string;
                }
                const resolver = pendingRequests.get(realReq);
                if (resolver) {
                    resolver({
                        status,
                        message: message || undefined,
                        data: data || undefined
                    }, true);

                    if (logFailures) {
                        console.error(new Error(message));
                    }
                }
            } else {
                const resolver = pendingRequests.get(id);
                let requestedData = responses.get(id);
                let realData: any;
                try {
                    realData = JSON.parse(requestedData)
                } catch { }
                if (resolver) {
                    resolver({
                        status,
                        message: message || undefined,
                        data: requestedData ?? data,
                        getData() {
                            return realData
                        },
                    }, true);
                }
            }
            return { status: CustomCommandStatus.Success };
        }

        function setCMD(origin: CustomCommandOrigin, setAction: SetActions, requestId: string, rawData: string): CustomCommandResult {
            if (setAction == SetActions.Add) {
                let raw = responses.get(requestId) as string ?? ""
                raw += rawData
                responses.set(requestId, raw);
            }
            if (setAction == SetActions.Remove) {
                world.setDynamicProperty(rawData);
            }
            if (setAction == SetActions.Reset) {
                responses.delete(requestId)
            }
            if (setAction == SetActions.Get) {
                return { status: CustomCommandStatus.Success, message: `${responses.get(requestId)}` }
            }
            if (setAction == SetActions.Set) {
                responses.set(requestId, rawData)
            }
            return { status: CustomCommandStatus.Success };
        }
    }
    /**
     * @remarks Sends a request with the raw data you give it and returns a response. Runs for each in the player list (defaults to only hosts).
     */
    private async sendRequestAsync(data: Request, timeoutTicks = 50): Promise<ServerResponse> {
        return new Promise<ServerResponse>(async (resolve, reject) => {
            if (!data.id) return reject(new Error("No request ID!"));
            if (!data.type) return reject(new Error("No request type!"));

            const id = data.id;
            const timeout = system.runTimeout(() => {
                world.setDynamicProperty(`hivemindRequest${id}`)
                this.pendingRequests.delete(id);
                reject(new Error("Timed out on waiting for server response. Make sure you are connected: /script debugger connect traye.ddns.net"));
            }, timeoutTicks);

            this.pendingRequests.set(id, (response, done) => {
                system.clearRun(timeout);
                if (done) {
                    this.pendingRequests.delete(id);
                    resolve(response);
                    this.responses.delete(id);
                }
            });

            world.setDynamicProperty(`hivemindRequest${id}`, JSON.stringify(data));
        });
    }
    private id() {
        return Date.now() + ":" + this.apiName
    }
    private buildRequest(type: RequestTypes, data: RequestData = {}) {
        return {
            id: this.id(),
            type,
            apiName: this.apiName,
            scriptEvent: this.scriptEvent,
            data,
        } as Request
    }
    /**
     *  @remarks Sends a fetch request to a uri.
     */
    async sendHttpRequest(uri: string, init?: RequestInit, timeoutTicks = 50) {
        return await this.sendRequestAsync(this.buildRequest(RequestTypes.HttpRequest, { uri, init }), timeoutTicks)
    }
}