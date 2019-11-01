import { Connection, ConnectStatus } from './Connection';
import * as events from 'events';
import * as net from 'net';
import {
    BaseBreakPoint, RunningStatus, Expression, VariablesDefine, GDBFrame,
    TCPData, tcpDataSeparator, DebugContent
} from './GDBProtocol';
import { GlobalEvent } from './GlobalEvents';
import { Message } from './Message';

type Breakpoint = BaseBreakPoint;
type BreakpointHitData = RunningStatus;
type NotifyData<T> = T | undefined;

export interface OnStoppedData {
    command: string;
    hitInfo: NotifyData<BreakpointHitData>;
}

export class GDBConnection extends events.EventEmitter implements Connection {

    Send(event: 'init', elfFile: string): Promise<void>;
    Send(event: 'launch'): Promise<void>;
    Send(event: 'break', bp: Breakpoint): Promise<NotifyData<Breakpoint>>;
    Send(event: 'break main'): Promise<boolean>;
    Send(event: 'delete breakpoints', bp: Breakpoint): Promise<boolean>;
    Send(event: 'continue'): Promise<boolean>;
    Send(event: 'pause'): Promise<boolean>;
    Send(event: 'step'): Promise<boolean>;
    Send(event: 'step over'): Promise<boolean>;
    Send(event: 'info locals'): Promise<Expression[]>;
    Send(event: 'info variables'): Promise<VariablesDefine[]>;
    Send(event: 'info stack'): Promise<GDBFrame[]>;
    Send(event: 'print', variablesName: string): Promise<NotifyData<Expression>>;
    Send(event: 'set', expression: string): Promise<boolean>;
    Send(event: 'info registers'): Promise<Expression[]>;

    Send(event: any, argc?: any): Promise<any> {
        return new Promise((resolve, reject) => {

            if (event === 'step' || event === 'step over' || event === 'continue' || event === 'pause') {
                this.prevCommand = event;
            }

            super.once(event, (result?: any) => {
                resolve(result);
            });

            if (!this.Write(JSON.stringify(<TCPData>{
                tag: 'Debug',
                data: JSON.stringify(<DebugContent>{
                    command: event,
                    data: argc ? (typeof argc === 'string' ? argc : JSON.stringify(argc)) : ''
                })
            }))) {
                reject();
            }

        });
    }

    Notify(event: 'OnStopped', stoppedData: OnStoppedData): void;
    Notify(event: 'init'): void;
    Notify(event: 'launch'): void;
    Notify(event: 'break', bp: NotifyData<Breakpoint>): void;
    Notify(event: 'break main'): void;
    Notify(event: 'delete breakpoints', ok: boolean): void;
    Notify(event: 'continue', ok: boolean): void;
    Notify(event: 'pause', ok: boolean): void;
    Notify(event: 'step', ok: boolean): void;
    Notify(event: 'step over', ok: boolean): void;
    Notify(event: 'info locals', localVariables: Expression[]): void;
    Notify(event: 'info variables', varList: VariablesDefine[]): void;
    Notify(event: 'info stack', statckList: GDBFrame[]): void;
    Notify(event: 'print', variables: NotifyData<Expression>): void;
    Notify(event: 'set', ok: boolean): void;
    Notify(event: 'info registers', varList: Expression[]): void;

    Notify(event: any, argc?: any): void {
        super.emit(event, argc);
    }

    on(event: 'OnStopped', listener: (stoppedData: OnStoppedData) => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: 'line', listener: (data: string) => void): this;
    on(event: 'connect', listener: () => void): this;
    on(event: 'close', listener: () => void): this;
    on(event: any, listener: (argc?: any) => void): this {
        return super.on(event, listener);
    }

    emit(event: 'connect'): boolean;
    emit(event: 'close'): boolean;
    emit(event: 'error', err: Error): boolean;
    emit(event: 'line', line: string): boolean;
    emit(event: any, argc?: any): boolean {
        return super.emit(event, argc);
    }

    prevCommand: string;

    TAG: string = GDBConnection.name;

    private connection: net.Socket | undefined;
    private activeEnd: boolean;

    private status: ConnectStatus = ConnectStatus.Close;

    constructor() {
        super();
        this.activeEnd = false;
        this.prevCommand = '';
    }

    Connect(): Promise<boolean> {

        return new Promise((resolve, reject) => {

            this.status = ConnectStatus.Pending;

            this.connection = net.createConnection({
                host: 'localhost',
                port: 1122
            });
            this.connection.setEncoding('utf8');

            this.connection.on('connect', () => {
                this.status = ConnectStatus.Active;
                this.emit('connect');
                resolve(true);
            });

            this.connection.on('error', (err) => {
                this.emit('error', err);
            });

            this.connection.on('close', () => {
                if(this.status !== ConnectStatus.Active) {
                    reject();   
                }
                this.status = ConnectStatus.Close;
                this.emit('close');
            });

            this.connection.on('data', (data: string) => {
                let sList: string[] = data.split(tcpDataSeparator);
                sList.forEach(str => {
                    if (str.trim() !== '') {
                        this.emit('line', str);
                    }
                });
            });

            this.connection.on('end', () => {
                if (this.connection) {
                    if (!this.activeEnd) {
                        this.connection.end();
                    }
                    this.connection.destroy();
                }
            });

        });
    }

    async Close(): Promise<void> {
        return new Promise((resove) => {
            if (this.connection && !this.connection.destroyed) {
                this.activeEnd = true;
                this.connection.once('end', () => {
                    resove();
                });
                this.connection.end();
            } else {
                resove();
            }
        });
    }

    GetStatus(): ConnectStatus {
        return this.status;
    }

    private Write(data: string): boolean {
        if (this.connection) {
            try {
                return this.connection.write(data + tcpDataSeparator);
            } catch (err) {
                if (!this.activeEnd) {
                    GlobalEvent.emit('msg', <Message>{
                        type: 'Warning',
                        contentType: 'object',
                        content: JSON.stringify(err)
                    });
                } else {
                    GlobalEvent.emit('msg', <Message>{
                        type: 'Info',
                        contentType: 'object',
                        content: JSON.stringify(err)
                    });
                }
                return false;
            }
        }
        return false;
    }
}