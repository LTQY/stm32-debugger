import * as events from 'events';
import { DebugProtocol } from 'vscode-debugprotocol';
import { Handles, Source, Thread, Variable } from 'vscode-debugadapter';
import { TCPData, Expression, BaseBreakPoint, RunningStatus, VariablesDefine, GDBServerResponse, GDBFrame, BpHitCommand, GDBCommand, DataType, tcpDataSeparator } from './GDBProtocol';
import { JLinkConnection } from './JLinkConnection';
import { LaunchConfigManager } from './LaunchConfig';
import { Message } from './Message';
import { File } from './File';
import { GlobalEvent } from './GlobalEvents';
import { GDBConnection, OnStoppedData } from './GDBConnection';
import * as Path from 'path';
import { GDBWrapperServer } from './GDBWrapperServer';
import { Connection, ConnectStatus } from './Connection';
import { invalid_elf_file_path, invalid_svd_file_path, program_exit, receive_signal } from './StringTable';

type Breakpoint = BaseBreakPoint;
type BreakpointHitData = RunningStatus;
type NotifyData<T> = T | undefined;

export class VariablesHandles extends Handles<DebugProtocol.Variable>{
    constructor(startHandle?: number) {
        super(startHandle);
    }
}

enum ConnectionIndex {
    JLink = 0,
    GDBWrapper,
    GDB
}

export interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
    /** An absolute path to the "program" to debug. */
    program: string;

    svdPath?: string;
}

interface LaunchConfig {
    program: File;
    svdFile?: File;
}

interface CheckResult {
    success: boolean;
    msg?: Message;
}

class LaunchConfigChecker {

    LaunchArgsToConfig(launchArgs: LaunchRequestArguments): LaunchConfig {
        return {
            program: new File(launchArgs.program),
            svdFile: launchArgs.svdPath ? new File(launchArgs.svdPath) : undefined
        }
    }

    Check(config: LaunchConfig): CheckResult {
        let res: CheckResult = {
            success: true,
        };

        if (!config.program.IsExist()) {
            res.success = false;
            res.msg = {
                type: 'Warning',
                contentType: 'string',
                content: invalid_elf_file_path + ' !'
            }
        }

        if (config.svdFile) {
            if (!config.svdFile.IsExist()) {
                res.success = true;
                res.msg = {
                    type: 'Warning',
                    contentType: 'string',
                    content: invalid_svd_file_path + ' !'
                }
            }
        }
        return res;
    }
}

export enum RuntimeStatus {
    Stopped,
    Running
}

export class Runtime extends events.EventEmitter {

    private connectionList: Connection[] = [
        new JLinkConnection(),
        new GDBWrapperServer(),
        new GDBConnection(),
    ];

    private readyList: boolean[] = [];
    private launchConfig: LaunchConfig | undefined;
    private checker: LaunchConfigChecker;
    private status: RuntimeStatus = RuntimeStatus.Stopped;

    //gdb Data
    private globalVariables: VariablesDefine[] = [];
    private bpList: Breakpoint[] = [];
    private currentHitBp: BreakpointHitData | undefined;

    private preSetBpList: any[] = [];

    on(event: 'output', listener: (data: { line: string, type: string | undefined }) => void): this;
    on(event: 'request_close', listener: () => void): this;
    on(event: 'stopOnEntry', listener: (threadID: number) => void): this;
    on(event: 'stopOnStep', listener: (threadID: number) => void): this;
    on(event: 'stopOnBreakpoint', listener: (threadID: number) => void): this;
    on(event: 'stopOnDataBreakpoint', listener: (threadID: number) => void): this;
    on(event: 'stopOnException', listener: (threadID: number) => void): this;
    on(event: 'pause', listener: (threadID: number) => void): this;
    on(event: 'continue', listener: (threadID: number) => void): this;
    on(event: 'breakpointValidated', listener: (bp: DebugProtocol.Breakpoint) => void): this;
    on(event: any, listener: (argc?: any) => void): this {
        return super.on(event, listener);
    }

    once(event: 'close', listener: () => void): this;
    once(event: any, listener: (argc?: any) => void): this {
        return super.once(event, listener);
    }

    emit(event: 'output', data: { line: string, type: string | undefined }): boolean;
    emit(event: 'request_close'): boolean;
    emit(event: 'close'): boolean;
    emit(event: 'stopOnEntry', threadID: number): boolean;
    emit(event: 'stopOnStep', threadID: number): boolean;
    emit(event: 'stopOnBreakpoint', threadID: number): boolean;
    emit(event: 'stopOnDataBreakpoint', threadID: number): boolean;
    emit(event: 'stopOnException', threadID: number): boolean;
    emit(event: 'pause', threadID: number): boolean;
    emit(event: 'continue', threadID: number): boolean;
    emit(event: 'breakpointValidated', bp: DebugProtocol.Breakpoint): boolean;
    emit(event: any, argc?: any): boolean {
        return super.emit(event, argc);
    }

    constructor() {
        super();

        this.checker = new LaunchConfigChecker();

        this.RegisterCloseListener();

        (<GDBConnection>this.connectionList[ConnectionIndex.GDB]).on('OnStopped', (stoppedData: OnStoppedData) => {

            this.currentHitBp = stoppedData.hitInfo;

            if (this.currentHitBp) {
                switch (stoppedData.command) {
                    case 'continue':
                        this.emit('stopOnBreakpoint',
                            this.currentHitBp.info.thread_id ? Number.parseInt(this.currentHitBp.info.thread_id) : 1);
                        break;
                    case 'step':
                        this.emit('stopOnStep',
                            this.currentHitBp.info.thread_id ? Number.parseInt(this.currentHitBp.info.thread_id) : 1);
                        break;
                    case 'step over':
                        this.emit('stopOnStep',
                            this.currentHitBp.info.thread_id ? Number.parseInt(this.currentHitBp.info.thread_id) : 1);
                        break;
                    case 'pause':
                        this.emit('pause',
                            this.currentHitBp.info.thread_id ? Number.parseInt(this.currentHitBp.info.thread_id) : 1);
                        break;
                    default:
                        GlobalEvent.emit('msg', <Message>{
                            type: 'Warning',
                            contentType: 'string',
                            content: 'Can\'t stopped on error command \'' +
                                (<GDBConnection>this.connectionList[ConnectionIndex.GDB]).prevCommand + '\''
                        });
                        break;
                }
            } else {
                GlobalEvent.emit('error', new Error('\'bpHitInfo\' is undefined !'));
            }
        });
    }

    GetLaunchConfig(): LaunchConfig {
        if (this.launchConfig === undefined) {
            throw Error('Debug LaunchConfig is undefined');
        }
        return this.launchConfig;
    }

    private async OnClose() {

        for (let i = this.connectionList.length - 1; i >= 0; i--) {
            if (this.connectionList[i].GetStatus() === ConnectStatus.Active) {
                await this.connectionList[i].Close();
            }
        }

        this.emit('close');

        this.status = RuntimeStatus.Stopped;
    }

    private RegisterCloseListener() {
        this.on('request_close', () => {
            this.OnClose();
        });
        this.once('close', () => {
            GlobalEvent.emit('msg', <Message>{
                type: 'Info',
                contentType: 'string',
                content: program_exit
            });
        });
    }

    GetStatus(): RuntimeStatus {
        return this.status;
    }

    async Connect(): Promise<boolean> {

        let configName = await LaunchConfigManager.GetInstance().SelectConfig();

        if (configName === undefined) {

            console.log('Select canceled !');

            return new Promise((resolve) => { resolve(false); });

        } else {

            let connectOk = false;

            for (let i = 0; i < this.connectionList.length; i++) {

                const con = this.connectionList[i];

                con.on('close', () => {
                    this.Disconnect();
                });

                con.on('error', (err) => {
                    GlobalEvent.emit('msg', {
                        type: 'Warning',
                        contentType: 'exception',
                        content: JSON.stringify(err),
                        className: con.TAG
                    });
                });

                con.on('stdout', (line) => {
                    this.emit('output', { line: line, type: 'log' });
                });

                con.on('stderr', (line) => {
                    this.emit('output', { line: line, type: 'warn' });
                });

                switch (i) {
                    case ConnectionIndex.GDB:
                        {
                            (<GDBConnection>con).on('line', (line) => {
                                try {
                                    let tcpData = <TCPData>JSON.parse(line);
                                    this.HandleData(tcpData);
                                } catch (err) {
                                    GlobalEvent.emit('error', err);
                                }
                            });
                        }
                        break;
                    case ConnectionIndex.GDBWrapper:
                        break;
                    case ConnectionIndex.JLink:
                        break;
                    default:
                        break;
                }

                connectOk = await con.Connect(configName);

                if (!connectOk) {
                    return new Promise((resolve) => { resolve(false); });
                }
            }

            return new Promise((resolve) => { resolve(true); });
        }
    }

    PreSetBreakpoints(path: string, lines: number[]): any[] {
        this.preSetBpList.push({
            path: path,
            lines: lines
        });
        return this.preSetBpList;
    }

    async Init(launchArgc: LaunchRequestArguments): Promise<void> {

        this.launchConfig = this.checker.LaunchArgsToConfig(launchArgc);

        let checkRes = this.checker.Check(this.launchConfig);

        if (checkRes.msg) {
            GlobalEvent.emit('msg', checkRes.msg);
        }

        if (!checkRes.success) {
            this.Disconnect();
        }

        await (<GDBConnection>this.connectionList[ConnectionIndex.GDB]).Send('init', this.GetLaunchConfig().program.path);

        for (let i = 0; i < this.preSetBpList.length; i++) {
            const bpList = await this.setBreakpoints(this.preSetBpList[i].path, this.preSetBpList[i].lines);
            bpList.forEach((bp) => {
                this.emit('breakpointValidated', {
                    id: bp.id,
                    source: this.CreateSource(bp.source),
                    line: bp.lineNum,
                    verified: bp.verified
                });
            });
        }

        this.preSetBpList = [];

        return new Promise((resolve) => {
            resolve();
        });
    }

    private HandleData(tcpData: TCPData) {
        switch (tcpData.tag) {
            case 'Debug':
                this.HandleDebugResponse(<GDBServerResponse>JSON.parse(tcpData.data));
                break;
            case 'Close':
                {
                    GlobalEvent.emit('error', new Error('GDBWrapper Crashed, Debugger Stopped !'));
                    let gdbMsg: Message = JSON.parse(tcpData.data);
                    gdbMsg.appName = 'CL.gdbWrapper';
                    GlobalEvent.emit('msg', gdbMsg);
                    this.Disconnect();
                }
                break;
            default:
                this.Handle_Unknown(tcpData);
                break;
        }
    }

    private AllReady(): boolean {
        if (this.readyList.length >= 4) {
            for (let i = 0; i < this.readyList.length; i++) {
                if (!this.readyList[i]) {
                    return false;
                }
            }
            return true;
        }
        return false;
    }

    private HandleDebugResponse(response: GDBServerResponse) {

        let gdbConnection: GDBConnection = (<GDBConnection>this.connectionList[ConnectionIndex.GDB]);

        switch (response.command) {
            case 'init':
                {
                    if (response.status.isDone) {
                        gdbConnection.Notify('init');
                    } else {
                        if (response.status.msg) {
                            GlobalEvent.emit('msg', {
                                type: 'Warning',
                                contentType: 'object',
                                content: response.status.msg
                            });
                        }
                        this.Disconnect();
                    }
                }
                break;
            case 'file':
            case 'target remote':
            case 'load':
                this.readyList.push(response.status.isDone);
                break;
            case 'undisplay':
                this.readyList.push(response.status.isDone);
                if (this.AllReady()) {
                    gdbConnection.Notify('launch');
                } else {
                    this.Disconnect();
                }
                break;
            case BpHitCommand:
                if (response.runningStatus && response.runningStatus.info.reason === 'signal_received') {
                    GlobalEvent.emit('msg', <Message>{
                        type: 'Warning',
                        methodName: this.HandleDebugResponse.name,
                        className: Runtime.name,
                        contentType: 'object',
                        content: JSON.stringify(response.runningStatus)
                    });
                    GlobalEvent.emit('msg', {
                        type: 'Warning',
                        contentType: 'string',
                        content: receive_signal + response.runningStatus.info.signal_name
                    });
                    this.Disconnect();
                } else {
                    gdbConnection.Notify('OnStopped', {
                        command: gdbConnection.prevCommand,
                        hitInfo: response.runningStatus
                    });
                }
                break;
            case 'break':
                gdbConnection.Notify('break', <Breakpoint>response.result);
                break;
            case 'delete breakpoints':
                gdbConnection.Notify('delete breakpoints', response.status.isDone);
                break;
            case 'continue':
                gdbConnection.Notify('continue', response.status.isDone);
                break;
            case 'step':
                gdbConnection.Notify('step', response.status.isDone);
                break;
            case 'step over':
                gdbConnection.Notify('step over', response.status.isDone);
                break;
            case 'info locals':
                gdbConnection.Notify('info locals', <Expression[]>response.result);
                break;
            case 'info variables':
                gdbConnection.Notify('info variables', <VariablesDefine[]>response.result);
                break;
            case 'info stack':
                gdbConnection.Notify('info stack', <GDBFrame[]>response.result);
                break;
            case 'print':
                gdbConnection.Notify('print', response.result ? (<Expression[]>response.result)[0] : undefined);
                break;
            case 'set':
                gdbConnection.Notify('set', response.status.isDone);
                break;
            case 'info registers':
                gdbConnection.Notify('info registers', <Expression[]>response.result);
                break;
            default:
                console.log('Ignore command \'' + response.command + '\'');
                break;
        }

        if (!response.status.isDone && response.status.msg) {

            GlobalEvent.emit('msg', <Message>{
                type: 'Warning',
                contentType: 'string',
                title: 'Debugger Warning',
                className: Runtime.name,
                methodName: this.HandleDebugResponse.name,
                content: response.status.msg
            });

            switch (response.command) {
                case 'init':
                case 'file':
                case 'target remote':
                case 'load':
                    this.Disconnect();
                    break;
                default:
                    break;
            }
        }
    }

    private Handle_Unknown(tData: TCPData) {
        console.log('Unknown debug command TAG\'' + tData.tag + '\'');
    }

    async Disconnect(): Promise<void> {
        return new Promise((resolve) => {
            this.once('close', () => {
                resolve();
            });
            this.emit('request_close');
        });
    }

    async start(): Promise<void> {
        this.status = RuntimeStatus.Running;
        return (<GDBConnection>this.connectionList[ConnectionIndex.GDB]).Send('launch');
    }

    async clearBreakpoints(path: string): Promise<void> {

        for (let i = 0; i < this.bpList.length; i++) {
            await (<GDBConnection>this.connectionList[ConnectionIndex.GDB]).Send('delete breakpoints', this.bpList[i]);
        }

        this.bpList = [];

        return new Promise((resolve) => { resolve(); });
    }

    async setBreakpoint(path: string, line: number): Promise<Breakpoint> {
        return new Promise((resolve) => {
            let breakpoint: Breakpoint = {
                id: 0,
                source: path,
                lineNum: line,
                verified: false
            };
            (<GDBConnection>this.connectionList[ConnectionIndex.GDB]).Send('break', breakpoint).then((res) => {
                if (res) {
                    breakpoint.id = res.id;
                    breakpoint.lineNum = res.lineNum;
                    breakpoint.verified = res.verified;
                    resolve(breakpoint);
                } else {
                    resolve();
                }
            });
        });
    }

    async setBreakpoints(path: string, lines: number[]): Promise<Breakpoint[]> {

        this.bpList = [];
        let bp: Breakpoint;

        for (let i = 0; i < lines.length; i++) {
            bp = await this.setBreakpoint(path, lines[i]);
            if (bp) {
                this.bpList.push(bp);
            }
        }

        return new Promise((resolve) => {
            resolve(this.bpList);
        });
    }

    async stack(frameStart: number, frameEnd: number): Promise<DebugProtocol.StackFrame[]> {
        return new Promise((resolve) => {
            (<GDBConnection>this.connectionList[ConnectionIndex.GDB]).Send('info stack').then((frames) => {
                let stackList: DebugProtocol.StackFrame[] = [];

                frames.forEach((frame) => {
                    if (frame.id !== undefined && frame.line != undefined) {
                        stackList.push({
                            id: frame.id,
                            name: frame.func,
                            source: frame.file ? this.CreateSource(frame.file) : undefined,
                            line: Number.parseInt(frame.line.trim()),
                            column: 0
                        });
                    }
                });

                resolve(stackList);
            });
        });
    }

    async getThreads(): Promise<Thread[]> {
        return new Promise((resolve) => {
            resolve([{ id: 1, name: 'Main Thread' }]);
        });
    }

    async continue(): Promise<void> {
        return new Promise((resolve) => {
            (<GDBConnection>this.connectionList[ConnectionIndex.GDB]).Send('continue').then((isDone) => {
                resolve();
                this.emit('continue', 1);
            });
        });
    }

    async pause(): Promise<void> {
        return new Promise((resolve) => {
            (<GDBConnection>this.connectionList[ConnectionIndex.GDB]).Send('pause').then((isDone) => {
                resolve();
                this.emit('pause', 1);
            });
        });
    }

    async step(): Promise<void> {
        return new Promise((resolve) => {
            (<GDBConnection>this.connectionList[ConnectionIndex.GDB]).Send('step').then((isDone) => {
                resolve();
            });
        });
    }

    async stepOver(): Promise<void> {
        return new Promise((resolve) => {
            (<GDBConnection>this.connectionList[ConnectionIndex.GDB]).Send('step over').then((isDone) => {
                resolve();
            });
        });
    }

    async getRegister(): Promise<DebugProtocol.Variable[]> {
        return new Promise((resolve) => {
            (<GDBConnection>this.connectionList[ConnectionIndex.GDB]).Send('info registers').then((valList) => {
                let variablesList: DebugProtocol.Variable[] = [];
                valList.forEach((v) => {
                    variablesList.push({
                        name: v.name,
                        value: v.val,
                        variablesReference: 0,
                        presentationHint: {
                            kind: 'data'
                        }
                    });
                });
                resolve(variablesList);
            });
        });
    }

    private ExpressionToVariables(vHandler: VariablesHandles, expr: Expression): Variable {
        let v: DebugProtocol.Variable = new Variable(expr.name, '');
        let child: DebugProtocol.Variable;

        switch (expr.dataType) {
            case 'array':
            case 'char_array':
                v.type = 'array';
                v.value = 'array [' + (<any[]>JSON.parse(expr.val)).length.toString() + ']';

                child = new Variable('real', expr.val);
                child.type = 'array';

                v.variablesReference = vHandler.create(child);
                break;
            case 'integer':
                v.type = 'integer'
                v.value = expr.val;
                break;
            case 'float':
                v.type = 'float'
                v.value = expr.val;
                break;
            case 'object':
                v.type = 'object';
                v.value = 'Object ' + expr.val;

                child = new Variable('real', expr.val);
                child.type = 'object';

                v.variablesReference = vHandler.create(child);
                break;
            default:
                GlobalEvent.emit('msg', <Message>{
                    type: 'Warning',
                    contentType: 'string',
                    content: 'Unknown Expression.dataType \'' + expr.dataType + '\''
                });
                break;
        }

        return v;
    }

    private GetDataType(val: string): DataType {
        let reg_integer = new RegExp(/^-?\s*[0-9]+$/, 'g');
        let reg_hex = new RegExp(/^(?:0x|0X)[0-9a-fA-F]+$/, 'g');
        let reg_float = new RegExp(/^-?\s*[0-9]+\.[0-9]+$/, 'g');

        val = val.trim();

        if (reg_integer.test(val) || reg_hex.test(val)) {
            return 'integer';
        }

        if (reg_float.test(val)) {
            return "float";
        }

        return 'object';
    }

    async getLocal(vHandler: VariablesHandles): Promise<DebugProtocol.Variable[]> {
        return new Promise((resolve) => {
            (<GDBConnection>this.connectionList[ConnectionIndex.GDB]).Send('info locals').then((valList) => {
                let variablesList: DebugProtocol.Variable[] = [];
                let nVal: DebugProtocol.Variable;
                valList.forEach((v) => {
                    variablesList.push(this.ExpressionToVariables(vHandler, v));
                });

                if (this.currentHitBp && this.currentHitBp.info.frame) {
                    this.currentHitBp.info.frame.args.forEach((argc) => {

                        variablesList.push(this.ExpressionToVariables(vHandler, {
                            name: argc.name,
                            val: argc.value,
                            dataType: this.GetDataType(argc.value)
                        }));
                    });
                }

                resolve(variablesList);
            });
        });
    }

    async InitGlobalVariables(): Promise<void> {
        return new Promise(async (resolve) => {

            this.globalVariables = await (<GDBConnection>this.connectionList[ConnectionIndex.GDB]).Send('info variables');

            if (!this.globalVariables) {
                this.globalVariables = [];
            }

            resolve();
        });
    }

    async getGlobal(vHandler: Handles<DebugProtocol.Variable>): Promise<DebugProtocol.Variable[]> {
        return new Promise(async (resolve) => {
            let list: DebugProtocol.Variable[] = [];
            let expr: NotifyData<Expression>;

            for (let i = 0; i < this.globalVariables.length; i++) {
                expr = await (<GDBConnection>this.connectionList[ConnectionIndex.GDB]).Send('print', this.globalVariables[i].name);
                if (expr) {
                    expr.name = this.globalVariables[i].name;
                    list.push(this.ExpressionToVariables(vHandler, expr));
                }
            }

            resolve(list);
        });
    }

    private CreateSource(path: string): DebugProtocol.Source {
        return new Source(Path.basename(path), path);
    }

}