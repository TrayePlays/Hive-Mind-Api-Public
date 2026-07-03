import { CommandPermissionLevel, CustomCommandOrigin, CustomCommandParamType, system, world, CustomCommandResult, CustomCommandStatus, CustomCommand, CustomCommandSource } from "@minecraft/server";

const VERSION = 0.3;

// Enums converted to plain objects
export const RequestTypes = {
    HttpRequest: "httpRequest"
};

export const ServerStatusResponse = {
    Ran: -1,
    Success: 0,
    Failure: 1
};

export const SetActions = {
    Set: "set",
    Reset: "reset",
    Add: "add",
    Get: "get",
    Remove: "remove"
};

export class HivemindAPI {
    constructor(apiName, settings = { namespace: "hivemind", scriptEvent: true, logFailures: true }) {
        if (settings.logFailures === undefined) settings.logFailures = true;
        if (settings.namespace === undefined) settings.namespace = "hivemind";
        if (settings.scriptEvent === undefined) settings.scriptEvent = true;

        this.logFailures = settings.logFailures;
        this.scriptEvent = settings.scriptEvent;
        this.pendingRequests = new Map();
        this.responses = new Map();
        this.apiName = apiName;
        this.namespace = settings.namespace;

        this.setupListeners();
        this.initSetup();
    }

    initSetup() {
        system.run(() => {
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

                if (id === "hivemind:purpose") purposeCMD(origin);
                if (id === "hivemind:hivemind") hivemindCMD(origin);
                if (id === "hivemind:respond") respondCMD(origin, message);
                if (id === "hivemind:set") setCMD(origin, args[0], args[1], message.slice(args[0].length + args[1].length + 2));
                
            });
        } else {
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
            let resolver, requestedData, realData;

            if (status === ServerStatusResponse.Ran) {
                resolver = pendingRequests.get(id);
                requestedData = responses.get(id);

                try {
                    requestedData = JSON.parse(requestedData);
                    if (scriptEvent) requestedData = JSON.parse(requestedData);
                } catch { }

                if (resolver) {
                    world.setDynamicProperty(`hivemindRequest${id}`);
                    resolver({ status, message: message || undefined, data: requestedData ?? data }, false);
                }
            }
            else if (status === ServerStatusResponse.Failure) {
                let realReq = id || Array.from(pendingRequests.keys()).pop();
                resolver = pendingRequests.get(realReq);

                if (resolver) {
                    resolver({ status, message: message || undefined, data: data || undefined }, true);
                    if (logFailures) console.error(new Error(message));
                }
            }
            else {
                resolver = pendingRequests.get(id);
                requestedData = responses.get(id);

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

        function setCMD(origin, setAction, requestId, rawData) {
            if (setAction === SetActions.Add) {
                let raw = responses.get(requestId) || "";
                raw += rawData;
                responses.set(requestId, raw);
            }


            if (setAction === SetActions.Remove) {
                const chunks = world?.getDynamicProperty(`hivemindRequest${requestId}|meta`) ?? 0
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
                responses.set(requestId, rawData);
            }

            return { status: CustomCommandStatus.Success };
        }
    }

    splitString(str, size = 32767) {
        const chunks = [];
        for (let i = 0; i < str.length; i += size) {
            chunks.push(str.substring(i, i + size));
        }
        return chunks;
    }

    async sendRequestAsync(data, timeoutTicks = 50) {
        return new Promise((resolve, reject) => {
            if (!data.id) return reject(new Error("No request ID!"));
            if (!data.type) return reject(new Error("No request type!"));

            const id = data.id;

            const timeout = system.runTimeout(() => {
                world.setDynamicProperty(`hivemindRequest${id}`);
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

            const json = JSON.stringify(data);
            const chunks = this.splitString(json);

            world.setDynamicProperty(`hivemindRequest${id}|meta`, chunks.length);

            for (let i = 0; i < chunks.length; i++) {
                world.setDynamicProperty(`hivemindRequest${id}|${i}`, chunks[i]);
            }
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

    async sendHttpRequest(uri, init, timeoutTicks = 50) {
        return await this.sendRequestAsync(this.buildRequest(RequestTypes.HttpRequest, { uri, init }), timeoutTicks);
    }
}