export type MessageType = 'Info' | 'Warning' | 'Error';

export type ContentType = 'string' | 'object' | 'exception';

export interface ExceptionMessage {
    name?: string;
    message: string;
    stack?: string;
}

export interface Message {
    type: MessageType;
    title?: string;
    content: string;
    contentType: ContentType;
    //---------extra----------------
    appName?: string;
    className?: string;
    methodName?: string;
    timeStamp?: string;
    uid?: string;
}

export function ExceptionToMessage(err: Error): Message {
    return <Message>{
        type: 'Error',
        contentType: 'exception',
        content: JSON.stringify(<ExceptionMessage>{
            name: err.name,
            message: err.message,
            stack: err.stack
        })
    };
}