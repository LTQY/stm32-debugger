import { Connection, ConnectStatus } from "./Connection";
import * as events from 'events';
import { ExeModule } from "./Executable";
import { ResManager } from "./ResManager";
import * as path from 'path';
import { File } from "./File";

export class GDBWrapperServer implements Connection {

    TAG: string = GDBWrapperServer.name;

    static moduleName = 'server.js';

    private _event: events.EventEmitter;
    private process: ExeModule;

    protected status: ConnectStatus;

    constructor() {
        this.status = ConnectStatus.Close;
        this._event = new events.EventEmitter();
        this.process = new ExeModule();
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

    Connect(): Promise<boolean> {

        if (this.status === ConnectStatus.Active) {
            return new Promise((resolve) => {
                resolve(true);
            });
        }

        return new Promise((resolve) => {

            this.status = ConnectStatus.Pending;

            this.process.on('launch', () => {
                this.status = ConnectStatus.Active;
                resolve(true);
            });

            this.process.on('close', (exitInfo) => {
                if (this.status !== ConnectStatus.Active) {
                    resolve(false);
                }
                this.status = ConnectStatus.Close;
                this._event.emit('close');
            });

            this.process.on('error', (err) => {
                this._event.emit('error', err);
            });

            let exeFile: File = new File(ResManager.GetInstance().GetGDBWrapperDir().path + path.sep + GDBWrapperServer.moduleName);

            const logPath: string = ResManager.GetInstance().GetLogDir().path + File.sep + GDBWrapperServer.name + '.log';

            this.process.Run(exeFile.path, [logPath]);
        });
    }

    async Close(): Promise<void> {
        await this.process.Kill();
        this.status = ConnectStatus.Close;
    }
}