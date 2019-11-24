import { EventEmitter } from "events";
import { Message, MessageType, ExceptionMessage } from './Message';
import { GlobalEvent } from "./GlobalEvents";

let _analyzer: LogAnalyzer;

export interface DisplayableMessage {
    title?: string;
    text: string;
}

interface AnalyzeResult {
    displayable?: DisplayableMessage;
    isLog: boolean;
    msg: Message;
}

type MessageCategory = MessageType | 'Log';

export class LogAnalyzer {

    private _event: EventEmitter;

    private constructor() {
        this._event = new EventEmitter();
        this._event.on('msg', (msg) => this.DispatchMessage(msg));
    }

    static GetInstance(): LogAnalyzer {
        if (_analyzer === undefined) {
            _analyzer = new LogAnalyzer();
        }
        return _analyzer;
    }

    private DispatchMessage(msg: Message) {
        
        const res = this.Analyze(msg);

        if (res.isLog) {
            this._event.emit('Log', res.msg);
        }

        switch (res.msg.type) {
            case 'Warning':
                if (res.displayable) {
                    this._event.emit('Warning', res.displayable);
                }
                break;
            case 'Error':
                if (res.displayable) {
                    this._event.emit('Error', res.displayable);
                }
                break;
            case 'Info':
                if (res.displayable) {
                    this._event.emit('Info', res.displayable);
                }
                break;
            default:
                console.log('Analyzed unknown categroy message !');
                break;
        }
    }

    private Analyze(msg: Message): AnalyzeResult {
        const res: AnalyzeResult = {
            msg: msg,
            isLog: true
        };

        switch (msg.type) {
            case 'Error':
                this.AnalyzeError(res);
                break;
            case 'Warning':
                this.AnalyzeWarning(res);
                break;
            case 'Info':
                this.AnalyzeInfo(res);
                break;
            default:
                break;
        }

        return res;
    }

    private AnalyzeError(result: AnalyzeResult) {
        if (result.msg.contentType === 'string') {
            result.displayable = {
                title: result.msg.className,
                text: result.msg.content
            };
        }
    }

    private AnalyzeWarning(result: AnalyzeResult) {
        if (result.msg.contentType === 'string') {
            result.isLog = false;
            result.displayable = {
                title: result.msg.className,
                text: result.msg.content
            };
        }
    }

    private AnalyzeInfo(result: AnalyzeResult) {
        if (result.msg.contentType === 'string') {
            result.isLog = false;
            result.displayable = {
                title: result.msg.title,
                text: result.msg.content
            };
        }
    }

    static on(event: 'Warning', listener: (msg: DisplayableMessage) => void): void;
    static on(event: 'Error', listener: (msg: DisplayableMessage) => void): void;
    static on(event: 'Info', listener: (msg: DisplayableMessage) => void): void;
    static on(event: 'Log', listener: (msg: Message) => void): void;
    static on(event: MessageCategory, args?: any): void {
        LogAnalyzer.GetInstance()._event.on(event, args);
    }

    static emit(event: 'msg', msg: Message): boolean;
    static emit(event: any, args?: any): boolean {
        return LogAnalyzer.GetInstance()._event.emit(event, args);
    }

}

GlobalEvent.on('msg', (msg: Message) => {
    LogAnalyzer.emit('msg', msg);
});