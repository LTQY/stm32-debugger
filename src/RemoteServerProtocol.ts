import { Message } from './Message';

export interface LogData {
    warning?: Message[];
    error?: Message[];
    info?: Message[];
    other?: Message[];
}

export interface RemoteRequest {
    appName: string;
    data: string;
    timeStamp: string;
    uid: string;
}

export interface RemoteResponse {
    appName?: string;
    version?: string;
    activeTime: number;     //hour
    msg: string[];          // 2 element, chinese or english
    timeStamp: string;
}