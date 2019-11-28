export interface RemoteRequest {
    appName: string;
    version: string;
    tag: string;
    uuid: string;
    md5: string;
    data: string;
}

export interface RemoteResponse {
    success: boolean;
    data?: string;
    md5?: string;
}