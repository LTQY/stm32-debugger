import * as events from 'events';
import { File } from '../lib/node-utility/File';
import { ResManager } from './ResManager';
import * as Path from 'path';
import { JLinkConfig, LaunchConfigManager } from './LaunchConfig';
import { GlobalEvent } from './GlobalEvents';
import { Connection, ConnectStatus } from './Connection';
import { ExeFile } from '../lib/node-utility/Executable';

export interface JLinkError {
    state: ConnectStatus;
    tag?: string;
    message?: string;
}

export class JLinkConnection implements Connection {

    TAG: string = JLinkConnection.name;

    private status: ConnectStatus;
    private process: ExeFile;
    private jLinkServer: File;
    private err: Error | null = null;
    private _event: events.EventEmitter;

    constructor() {
        this.status = ConnectStatus.Close;
        this._event = new events.EventEmitter();
        this.process = new ExeFile();
        this.jLinkServer = new File(ResManager.GetInstance().GetJLinkDir().path + Path.sep + 'JLinkGDBServerCL.exe');
    }

    once(event: 'close', listener: () => void): this;
    once(event: any, listener: (args?: any) => void): this {
        this._event.once(event, listener);
        return this;
    }

    emit(event: 'close'): boolean;
    emit(event: any, argc?: any): boolean {
        return this._event.emit(event, argc);
    }

    on(event: "stdout", listener: (str: string) => void): this;
    on(event: "stderr", listener: (str: string) => void): this;
    on(event: "connect", listener: () => void): this;
    on(event: "close", listener: () => void): this;
    on(event: "error", listener: (err: Error) => void): this;
    on(event: any, listener: (argc?: any) => void): this {
        this._event.on(event, listener);
        return this;
    }

    GetStatus(): ConnectStatus {
        return this.status;
    }

    async Connect(configName: string): Promise<boolean> {

        let res: JLinkError = {
            state: ConnectStatus.Close
        };

        if (this.status === ConnectStatus.Active) {
            return new Promise((resolve) => {
                resolve(true);
            });
        }

        let confList = LaunchConfigManager.GetInstance().GetConfigList()
        let index = confList.findIndex((config): boolean => {
            return config.name === configName ? true : false;
        });

        if (index !== -1 && this.jLinkServer.IsExist()) {
            let jLinkConf = confList[index];
            let checkRes = LaunchConfigManager.GetInstance().CheckConfig(jLinkConf);
            if (checkRes.state === 'pass') {
                return new Promise((resolve) => {
                    this._connect(jLinkConf).then(() => {
                        this._event.emit('connect');
                        resolve(true);
                    }, () => {
                        this._event.emit('close');
                        resolve(false);
                    });
                });
            } else {
                res.tag = checkRes.tag;
                res.message = checkRes.message;
            }
        }

        return new Promise((resolve) => {
            GlobalEvent.emit('msg', {
                className: JLinkConnection.name,
                methodName: this.Connect.name,
                type: 'Warning',
                contentType: 'object',
                content: JSON.stringify(res)
            });
            resolve(false);
        });
    }

    async Close(): Promise<void> {
        await this.process.Kill();
        this.status = ConnectStatus.Close;
    }

    private _connect(config: JLinkConfig): Promise<void> {

        return new Promise((resolve, reject) => {

            const exePath = this.jLinkServer.path.replace(/\\/g, '\\\\');
            const args: string[] = [];

            args.push('-select');
            args.push('USB');

            args.push('-device');
            args.push(config.device);

            args.push('-endian');
            args.push(config.endian);

            args.push('-if');
            args.push(config.protocolType);

            args.push('-speed');
            args.push(config.transmissionSpeed.toString());

            if (!config.initRegister) {
                args.push('-noir');
            }

            this.status = ConnectStatus.Pending;

            this.process.on('close', (exitInfo) => {

                this.status = ConnectStatus.Close;

                if (exitInfo.signal === 'SIGKILL') {
                    this.emit('close');
                } else {
                    if (this.err) {
                        GlobalEvent.emit('msg', {
                            type: 'Warning',
                            contentType: 'object',
                            content: JSON.stringify(this.err),
                            className: JLinkConnection.name,
                            methodName: this._connect.name
                        });
                    }
                }
            });

            let strList: string[] = [];

            this.process.on('line', (line) => {

                this._event.emit('stdout', '[JLinkGDBServer] : ' + line);

                strList.push(line);

                setTimeout(() => {
                    if (this.status === ConnectStatus.Pending) {
                        this.status = ConnectStatus.Close;
                        GlobalEvent.emit('msg', {
                            type: 'Warning',
                            className: JLinkConnection.name,
                            contentType: 'string',
                            methodName: this._connect.name,
                            content: 'JLink Connect Timeout !'
                        });
                        reject();
                    }
                }, 5000);

                if (/^J-Link is connected.$/.test(line)) {
                    this.status = ConnectStatus.Active;
                    resolve();
                }

                if (/^Connecting to J-Link failed.+$/.test(line)) {
                    this.status = ConnectStatus.Close;
                    GlobalEvent.emit('msg', {
                        type: 'Warning',
                        className: JLinkConnection.name,
                        contentType: 'object',
                        methodName: this._connect.name,
                        content: JSON.stringify(strList)
                    });
                    reject();
                }
            });

            this.process.Run(exePath, args, { windowsHide: true });
        });
    }
}