import { Connection, ConnectStatus } from "./Connection";
import * as events from 'events';
import { ExeModule } from "./Executable";
import { ResManager } from "./ResManager";
import * as path from 'path';
import { File } from "./File";

export class GDBWrapperConnection implements Connection {

    TAG: string = GDBWrapperConnection.name;

    static moduleName = 'server.js';

    private _event: events.EventEmitter;
    private process: ExeModule;

    protected status: ConnectStatus;

    constructor() {
        this.status = ConnectStatus.Close;
        this._event = new events.EventEmitter();
        this.process = new ExeModule();
    }

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

        return new Promise((resolve, reject) => {

            this.status = ConnectStatus.Pending;

            this.process.on('launch', () => {
                this.status = ConnectStatus.Active;
                resolve(true);
            });

            this.process.on('close', (exitInfo) => {
                if (this.status !== ConnectStatus.Active) {
                    reject();
                }
                this.status = ConnectStatus.Close;
                this._event.emit('close');
            });

            this.process.on('error', (err) => {
                this._event.emit('error');
            });

            this.process.on('line', (line) => {
                //do nothing
            });

            this.process.on('errLine', (errLine) => {
                //do nothing
            });

            let exeFile: File = new File(ResManager.GetInstance().GetGDBWrapperDir().path + path.sep + GDBWrapperConnection.moduleName);

            this.process.Run(exeFile.path, undefined, { cwd: exeFile.dir, detached: true });
        });
    }

    async Close(): Promise<void> {
        await this.process.Kill();
    }
}