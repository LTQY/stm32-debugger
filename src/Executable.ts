import * as process from 'child_process';
import * as events from 'events';
import * as ReadLine from 'readline';
import { GlobalEvent } from './GlobalEvents';

export type ExecutableOption = process.ExecFileOptions | process.ForkOptions;

export interface Executable {

    Run(exePath: string, args?: string[], options?: ExecutableOption): void;

    Kill(): void;

    on(event: 'launch', listener: () => void): this;

    on(event: 'close', listener: (exitInfo: ExitInfo) => void): this;

    on(event: 'error', listener: (err: Error) => void): this;

    on(event: 'line', listener: (line: string) => void): this;

    on(event: 'errLine', listener: (line: string) => void): this;
}

export interface ExitInfo {
    code: number;
    signal: string;
}

export abstract class Process implements Executable {

    static killSignal = 'SIGKILL';
    static codeType = 'utf8';

    protected _event: events.EventEmitter;
    protected proc: process.ChildProcess | undefined;
    protected launchTimeout: number;

    constructor(timeout?: number) {
        this.launchTimeout = timeout ? timeout : 0;
        this._event = new events.EventEmitter();
    }

    protected abstract Execute(exePath: string, args?: string[] | undefined, options?: ExecutableOption | undefined): process.ChildProcess;

    Run(exePath: string, args?: string[] | undefined, options?: ExecutableOption | undefined): void {

        this.proc = this.Execute(exePath, args, options);

        if (this.proc.stdout) {
            this.proc.stdout.setEncoding(Process.codeType);
            const stdout = ReadLine.createInterface({ input: this.proc.stdout });
            stdout.on('line', (line) => {
                this._event.emit('line', line);
            });
        }

        if (this.proc.stderr) {
            this.proc.stderr.setEncoding(Process.codeType);
            const stderr = ReadLine.createInterface({ input: this.proc.stderr });
            stderr.on('line', (line) => {
                this._event.emit('errLine', line);
            });
        }

        this.proc.on('error', (err) => {
            this._event.emit('error', err);
        });

        this.proc.on('close', (code, signal) => {
            this._event.emit('close', <ExitInfo>{
                code: code,
                signal: signal
            });
        });

        setTimeout((proc: process.ChildProcess) => {
            if (!proc.killed) {
                this._event.emit('launch');
            }
        }, this.launchTimeout, this.proc);
    }

    async Kill(): Promise<void> {
        return new Promise((resolve) => {
            if (this.proc && !this.proc.killed) {
                this._event.once('close', (exitInfo: ExitInfo) => {
                    resolve();
                    if (exitInfo.signal !== Process.killSignal) {
                        GlobalEvent.emit('error', new Error('Process killed with error signal !'));
                    }
                });
                this.proc.kill(Process.killSignal);
            } else {
                resolve();
            }
        });
    }

    on(event: "launch", listener: () => void): this;
    on(event: "close", listener: (exitInfo: ExitInfo) => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: "line", listener: (line: string) => void): this;
    on(event: "errLine", listener: (line: string) => void): this;
    on(event: any, listener: (argc?: any) => void) {
        this._event.on(event, listener);
        return this;
    }
}

export class ExeFile extends Process {

    protected Execute(exePath: string, args?: string[] | undefined, options?: ExecutableOption | undefined): process.ChildProcess {
        return process.execFile(exePath, args, options);
    }

}

export class ExeModule extends Process {

    protected Execute(exePath: string, args?: string[] | undefined, options?: ExecutableOption | undefined): process.ChildProcess {
        return process.fork(exePath, args, options);
    }

}