import { CommandPermissionLevel, CustomCommandParamType, system, world, CustomCommandStatus, CustomCommandSource } from "@minecraft/server";
const VERSION = 0.4;
/**
 * Soon to add more request types!
 */
export var RequestTypes;
(function (RequestTypes) {
    RequestTypes["HttpRequest"] = "httpRequest";
    RequestTypes["MidiRequest"] = "midiRequest";
})(RequestTypes || (RequestTypes = {}));
export var ServerStatusResponse;
(function (ServerStatusResponse) {
    ServerStatusResponse[ServerStatusResponse["Ran"] = -1] = "Ran";
    ServerStatusResponse[ServerStatusResponse["Success"] = 0] = "Success";
    ServerStatusResponse[ServerStatusResponse["Failure"] = 1] = "Failure";
})(ServerStatusResponse || (ServerStatusResponse = {}));
export var SetActions;
(function (SetActions) {
    SetActions["Set"] = "set";
    SetActions["Reset"] = "reset";
    SetActions["Add"] = "add";
    SetActions["Get"] = "get";
    SetActions["Remove"] = "remove";
})(SetActions || (SetActions = {}));
export class HivemindAPI {
    /**
     * @remarks If your project has a namespace, you will need to define it in the settings for the functions to properly work.
     * Requests may fail if you set nametag every tick. Settings for player list is who the request runs as.
     * They need to be connected to Hive Mind Servers for it to work!
     *
     * @warn Namespace MUST have no spaces!!!
     */
    constructor(apiName, settings = { namespace: "hivemind", scriptEvent: true, logFailures: true }) {
        if (settings.logFailures === undefined)
            settings.logFailures = true;
        if (settings.namespace === undefined)
            settings.namespace = "hivemind";
        if (settings.scriptEvent === undefined)
            settings.scriptEvent = true;
        this.logFailures = settings.logFailures;
        this.scriptEvent = settings.scriptEvent;
        this.pendingRequests = new Map();
        this.responses = new Map();
        this.apiName = apiName;
        this.namespace = settings.namespace;
        this.setupListeners();
        this.initSetup();
        this.loadTick = system.currentTick;
    }
    initSetup() {
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
        });
    }
    setupListeners() {
        const name = this.apiName;
        const logFailures = this.logFailures;
        const responses = this.responses;
        const pendingRequests = this.pendingRequests;
        const scriptEvent = this.scriptEvent;
        if (scriptEvent) {
            system.afterEvents.scriptEventReceive.subscribe(({ id, message, sourceEntity }) => {
                const origin = { sourceEntity, sourceType: CustomCommandSource.Entity };
                const args = message.split(" ");
                if (id === "hivemind:purpose")
                    purposeCMD(origin);
                if (id === "hivemind:hivemind")
                    hivemindCMD(origin);
                if (id === "hivemind:respond")
                    respondCMD(origin, message);
                if (id === "hivemind:set")
                    setCMD(origin, args[0], args[1], message.slice(args[0].length + args[1].length + 2));
            });
        }
        else {
            system.beforeEvents.startup.subscribe(({ customCommandRegistry }) => {
                const purpose = {
                    name: `${this.namespace}:purpose`,
                    description: "Checks purpose and name (FOR API)",
                    permissionLevel: CommandPermissionLevel.Admin
                };
                const hivemind = {
                    name: `${this.namespace}:hivemind`,
                    description: "Checks version of hivemind (FOR API)",
                    permissionLevel: CommandPermissionLevel.Admin
                };
                const respond = {
                    name: `${this.namespace}:respond`,
                    description: "Sets a response for data requested (FOR API)",
                    permissionLevel: CommandPermissionLevel.Admin,
                    mandatoryParameters: [
                        { name: "response", type: CustomCommandParamType.String }
                    ]
                };
                const set = {
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
            });
        }
        function purposeCMD(origin) {
            world.setDynamicProperty(`hivemindResponse`, JSON.stringify({
                version: VERSION,
                name,
                scriptEvent
            }));
            return { status: CustomCommandStatus.Success };
        }
        function hivemindCMD(origin) {
            return { status: CustomCommandStatus.Success, message: `Hive Mind API is on version ${VERSION}` };
        }
        function respondCMD(origin, response) {
            const [id, statusStr, message, data] = response.split("|");
            const status = parseInt(statusStr);
            let realData;
            const resolver = pendingRequests.get(id);
            let requestedData = responses.get(id);
            if (status == ServerStatusResponse.Ran) {
                try {
                    requestedData = JSON.parse(requestedData);
                    if (scriptEvent)
                        requestedData = JSON.parse(requestedData);
                }
                catch { }
                if (resolver) {
                    const chunks = world?.getDynamicProperty(`hivemindRequest${id}|meta`) ?? 0;
                    for (let i = 0; i < chunks; i++) {
                        world.setDynamicProperty(`hivemindRequest${id}|${i}`);
                    }
                    world.setDynamicProperty(`hivemindRequest${id}|meta`);
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
                    realReq = Array.from(pendingRequests.keys()).pop();
                }
                const resolver = pendingRequests.get(realReq);
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
            }
            else {
                try {
                    realData = JSON.parse(requestedData);
                }
                catch { }
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
        function setCMD(origin, setAction, requestId, rawData) {
            if (setAction === SetActions.Add) {
                let raw = responses.get(requestId) ?? "";
                raw += rawData;
                responses.set(requestId, raw);
            }
            if (setAction === SetActions.Remove) {
                const chunks = world?.getDynamicProperty(`hivemindRequest${requestId}|meta`) ?? 0;
                for (let i = 0; i < chunks; i++) {
                    world.setDynamicProperty(`hivemindRequest${requestId}|${i}`);
                }
                world.setDynamicProperty(`hivemindRequest${requestId}|meta`);
                // Works with old version too
                world.setDynamicProperty(rawData);
            }
            if (setAction == SetActions.Reset) {
                responses.delete(requestId);
            }
            if (setAction === SetActions.Get) {
                return { status: CustomCommandStatus.Success, message: `${responses.get(requestId)}` };
            }
            if (setAction === SetActions.Set) {
                responses.set(requestId, rawData);
            }
            return { status: CustomCommandStatus.Success };
        }
    }
    /**
     * @remarks Splits up string to the max limit Minecraft can handle in a dynamic property
     */
    splitString(str, size = 32767) {
        const chunks = [];
        for (let i = 0; i < str.length; i += size) {
            chunks.push(str.substring(i, i + size));
        }
        return chunks;
    }
    /**
     * @remarks Sends a request with the raw data you give it and returns a response. Runs for each in the player list (defaults to only hosts).
     */
    async sendRequestAsync(data, timeoutTicks = 50) {
        return new Promise((resolve, reject) => {
            if (system.currentTick == this.loadTick)
                return reject(new Error("You can't run this in a system.run do 2 system.runs or run another way."));
            if (!data.id)
                return reject(new Error("No request ID!"));
            if (!data.type)
                return reject(new Error("No request type!"));
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
                console.warn("Timed out on waiting for server response. Make sure you are connected: /script debugger connect traye.ddns.net");
                resolve({ status: ServerStatusResponse.Failure, message: "Timed out" });
            }, timeoutTicks);
            this.pendingRequests.set(id, (response, done) => {
                system.clearRun(timeout);
                if (done) {
                    this.pendingRequests.delete(id);
                    resolve(response);
                    this.responses.delete(id);
                }
            });
        });
    }
    id() {
        return Date.now() + ":" + this.apiName;
    }
    buildRequest(type, data = {}) {
        return {
            id: this.id(),
            type,
            apiName: this.apiName,
            scriptEvent: this.scriptEvent,
            data
        };
    }
    /**
     *  @remarks Sends a fetch request to a uri.
     */
    async sendHttpRequest(uri, init, extraInfo, timeoutTicks = 50) {
        return await this.sendRequestAsync(this.buildRequest(RequestTypes.HttpRequest, { uri, init, extraInfo }), timeoutTicks);
    }
    async sendMidiRequest(uri, extraInfo, timeoutTicks = 50) {
        return await this.sendRequestAsync(this.buildRequest(RequestTypes.MidiRequest, { uri, extraInfo }), timeoutTicks);
    }
}
