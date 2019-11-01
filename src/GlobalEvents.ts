import * as events from 'events';
import { Message, ExceptionToMessage } from './Message';
import { Time } from './Time';

let _globalEvent: GlobalEvent;

export class GlobalEvent {

    private _emitter: events.EventEmitter;

    private constructor() {
        this._emitter = new events.EventEmitter();
    }

    private static GetInstance(): GlobalEvent {
        if (_globalEvent) {
            return _globalEvent;
        }
        _globalEvent = new GlobalEvent();
        return _globalEvent;
    }

    //event
    static on(event: 'Extension_Close', listener: () => void): void;
    static on(event: 'Extension_Launch_Done', listener: () => void): void;

    static on(event: 'error', listener: (error: Error) => void): void;
    static on(event: 'msg', listener: (msg: Message) => void): void;
    static on(event: any, args?: any): void {
        GlobalEvent.GetInstance()._emitter.on(event, args);
    }

    static prepend(event: 'msg', listener: (msg: Message) => void): void;
    static prepend(event: any, args?: any): void {
        GlobalEvent.GetInstance()._emitter.prependListener(event, args);
    }

    static emit(event: 'Extension_Close'): boolean;
    static emit(event: 'Extension_Launch_Done'): boolean;

    static emit(event: 'error', error: Error): boolean;
    static emit(event: 'msg', msg: Message): boolean;
    static emit(event: any, args?: any): boolean {
        return GlobalEvent.GetInstance()._emitter.emit(event, args);
    }
}

GlobalEvent.prepend('msg', (msg) => {
    switch (msg.type) {
        case 'Error':
            console.error(JSON.stringify(msg));
            break;
        case 'Warning':
            console.warn(JSON.stringify(msg));
            break;
        default:
            console.info(JSON.stringify(msg));
            break;
    }
    if (msg.appName === undefined) {
        msg.appName = 'CL.stm32-debugger';
    }
    msg.timeStamp = Time.GetInstance().GetTimeStamp();
});

GlobalEvent.on('error', (err) => {
    if (err) {
        console.error(err);
        GlobalEvent.emit('msg', ExceptionToMessage(err));
    } else {
        GlobalEvent.emit('msg', ExceptionToMessage(new Error('Empty Error received !')));
    }
});

process.on('uncaughtException', (err: Error) => {
    GlobalEvent.emit('error', err);
});
