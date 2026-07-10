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

export interface HiveMindAPISettings {
    namespace?: string,
    scriptEvent?: boolean
    logFailures?: boolean
}

export class HivemindAPI {
    readonly apiName: string;
    readonly namespace: string;

    /**
     * @remarks If your project has a namespace, you will need to define it in the settings for the functions to properly work. 
     * Requests may fail if you set nametag every tick. Settings for player list is who the request runs as.
     * They need to be connected to Hive Mind Servers for it to work!
     */
    constructor(apiName: string, settings?: HiveMindAPISettings)
    /**
     *  @remarks Sends a fetch request to a uri.
     */
    sendHttpRequest(uri: string, init?: RequestInit, timeoutTicks?: number): Promise<ServerResponse>
}