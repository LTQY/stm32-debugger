import { Message } from './Message';

export interface UploadData {
    timeStamp: string;
    uid: string;
    content: LogData;
};

export interface LogData {
    warning?: Message[];
    error?: Message[];
    info?: Message[];
    other?: Message[];
}