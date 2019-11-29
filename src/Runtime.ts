import * as events from 'events';
import { DebugProtocol } from 'vscode-debugprotocol';
import { Handles, Source, Thread, Variable } from 'vscode-debugadapter';
import { TCPData, Expression, BaseBreakPoint, RunningStatus, VariablesDefine, GDBServerResponse, GDBFrame, BpHitCommand, GDBCommand, DataType, tcpDataSeparator } from './GDBProtocol';
import { JLinkConnection } from './JLinkConnection';
import { LaunchConfigManager } from './LaunchConfig';
import { Message } from './Message';
import { File } from '../lib/node-utility/File';
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
    program?: string;
    svdPath?: string;
}

interface CheckResult {
    success: boolean;
    msg?: Message;
}

class LaunchConfigChecker {

    Check(config: LaunchRequestArguments): CheckResult {

        let res: CheckResult = {
            success: true,
        };

        const program = config.program ? new File(config.program) : undefined;
        const svdFile = config.svdPath ? new File(config.svdPath) : undefined;

        if (program) {
            if (!program.IsExist()) {
                res.success = false;
                res.msg = {
                    type: 'Warning',
                    contentType: 'string',
                    content: invalid_elf_file_path + ' !'
                }
            }
        } else {
            res.success = false;
            res.msg = {
                type: 'Warning',
                contentType: 'string',
                content: 'Not found \'program\' in \'launch.json\', can\'t launch debugger !'
            }
        }

        if (svdFile) {
            if (!svdFile.IsExist()) {
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

export interface DebugOutputData {
    type?: 'stdout' | 'stderr';
    txt: string;
}

export class Runtime extends events.EventEmitter {

    private connectionList: Connection[] = [
        new JLinkConnection(),
        new GDBWrapperServer(),
        new GDBConnection(),
    ];

    private checker: LaunchConfigChecker;
    private status: RuntimeStatus = RuntimeStatus.Stopped;

    //gdb Data
    private globalVariables: VariablesDefine[] = [];
    private bpMap: Map<string, Breakpoint[]>;
    private currentHitBp: BreakpointHitData | undefined;

    private preSetBpMap: Map<string, Breakpoint[]>;

    on(event: 'output', listener: (data: DebugOutputData) => void): this;
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

    emit(event: 'output', data: DebugOutputData): boolean;
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

        this.preSetBpMap = new Map();

        this.bpMap = new Map();

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
                        this.emit('output', {
                            type: 'stderr',
                            txt: 'Can\'t stopped on error command \'' +
                                (<GDBConnection>this.connectionList[ConnectionIndex.GDB]).prevCommand + '\''
                        });
                        break;
                }
            } else {
                GlobalEvent.emit('error', new Error('\'bpHitInfo\' is undefined !'));
                this.emit('output', {
                    type: 'stderr',
                    txt: '\'bpHitInfo\' is undefined !'
                });
            }
        });
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

            this.emit('output', {
                type: 'stdout',
                txt: '[stm32-debugger] : debugger exited !'
            });

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

                con.on('stderr', (line) => {
                    this.emit('output', {
                        type: 'stderr',
                        txt: line
                    });
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
                        {
                            con.on('stdout', (line) => {
                                this.emit('output', {
                                    type: 'stdout',
                                    txt: line
                                });
                            });
                        }
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

    PreSetBreakpoints(path: string, lines: number[]): Breakpoint[] {

        const bpList = lines.map<BaseBreakPoint>((line): BaseBreakPoint => {
            return {
                source: path,
                lineNum: line,
                verified: false,
            };
        });

        this.preSetBpMap.set(path, bpList);

        return bpList;
    }

    async Init(launchArgc: LaunchRequestArguments): Promise<boolean> {

        let checkRes = this.checker.Check(launchArgc);

        if (checkRes.msg) {
            GlobalEvent.emit('msg', checkRes.msg);
        }

        if (!checkRes.success) {
            this.Disconnect();
            return new Promise((resolve) => {
                resolve(false);
            });
        }

        await (<GDBConnection>this.connectionList[ConnectionIndex.GDB]).Send('init', <string>launchArgc.program);

        for (let keyVal of this.preSetBpMap) {

            const bpList = await this.setBreakpoints(keyVal[0], keyVal[1].map<number>((bp) => { return <number>bp.lineNum; }));

            bpList.forEach((bp) => {
                this.emit('breakpointValidated', {
                    id: bp.id,
                    source: this.CreateSource(bp.source),
                    line: bp.lineNum,
                    verified: bp.verified
                });
            });
        }

        return new Promise((resolve) => {
            resolve(true);
        });
    }

    private HandleData(tcpData: TCPData) {
        switch (tcpData.tag) {
            case 'Debug':
                this.HandleDebugResponse(<GDBServerResponse>JSON.parse(tcpData.data));
                break;
            case 'error':
                {
                    GlobalEvent.emit('error', new Error('GDBWrapper Crashed, Debugger Stopped !'));
                    let gdbMsg: Message = JSON.parse(tcpData.data);
                    GlobalEvent.emit('msg', gdbMsg);
                    GlobalEvent.emit('debug-error');
                    this.Disconnect();
                }
                break;
            case 'close':
                {
                    GlobalEvent.emit('msg', {
                        type: 'Warning',
                        contentType: 'string',
                        content: 'GDBWrapper aborted !, [MSG]: ' + tcpData.data
                    });
                    this.Disconnect();
                }
                break;
            default:
                this.emit('output', { type: 'stderr', txt: 'Unknown debug command TAG\'' + tcpData.tag + '\'' });
                break;
        }
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
                    }
                }
                break;
            case 'file':
                if (!response.status.isDone) {
                    GlobalEvent.emit('msg', {
                        type: 'Warning',
                        contentType: 'string',
                        content: '[GDBWrapper] : load file error !, [MSG]: ' + (response.status.msg || '')
                    });
                }
                break;
            case 'launch':
                if (response.status.isDone) {
                    gdbConnection.Notify('launch');
                } else {
                    GlobalEvent.emit('msg', {
                        type: 'Warning',
                        contentType: 'string',
                        content: '[GDBWrapper] : gdb launch error !, [MSG]: ' + (response.status.msg || '')
                    });
                }
                break;
            case BpHitCommand:
                {
                    if (!response.status.isDone) {
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
                        } else {
                            GlobalEvent.emit('msg', {
                                type: 'Warning',
                                contentType: 'string',
                                content: 'hit breakpoint error !, [MSG]: ' + (response.status.msg ? response.status.msg : 'null')
                            });
                        }
                    } else {
                        gdbConnection.Notify('OnStopped', {
                            command: gdbConnection.prevCommand,
                            hitInfo: response.runningStatus
                        });
                    }
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
                gdbConnection.Notify('print', <Expression[]>response.result);
                break;
            case 'set':
                gdbConnection.Notify('set', response.status.isDone);
                break;
            case 'info registers':
                gdbConnection.Notify('info registers', <Expression[]>response.result);
                break;
            case 'x':
                gdbConnection.Notify('x', response.status.isDone ? (<Expression[]>response.result)[0] : undefined);
                break;
            default:
                console.warn('[Runtime] : Ignore command \'' + response.command + '\'');
                break;
        }

        if (!response.status.isDone && response.status.msg) {

            this.emit('output', {
                type: 'stderr',
                txt: '[GDBWrapper] : ' + response.status.msg
            });

            switch (response.command) {
                case 'init':
                case 'launch':
                case BpHitCommand:
                case 'step':
                case 'continue':
                case 'step over':
                case 'file':
                    this.Disconnect();
                    break;
                default:
                    break;
            }
        }
    }

    getALLBreakpoints(): DebugProtocol.Breakpoint[] {

        let res: DebugProtocol.Breakpoint[] = [];

        for (let bpList of this.bpMap.values()) {

            res = bpList.map<DebugProtocol.Breakpoint>((bp) => {
                return {
                    id: bp.id,
                    line: bp.lineNum,
                    source: this.CreateSource(bp.source),
                    verified: bp.verified,
                };
            });
        }

        return res;
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

        let bpList = this.bpMap.get(path);

        if (bpList) {

            for (let bp of bpList) {
                await (<GDBConnection>this.connectionList[ConnectionIndex.GDB]).Send('delete breakpoints', bp);
            }

            this.bpMap.set(path, []);
        }

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
                }

                resolve(breakpoint);
            });
        });
    }

    async setBreakpoints(path: string, lines: number[]): Promise<Breakpoint[]> {

        const _bpList: BaseBreakPoint[] = [];

        for (let line of lines) {

            const bp = await this.setBreakpoint(path, line);

            if (bp) {
                _bpList.push(bp);
            }
        }

        this.bpMap.set(path, _bpList);

        return new Promise((resolve) => {
            resolve(_bpList);
        });
    }

    async stack(frameStart: number, frameEnd: number): Promise<DebugProtocol.StackFrame[]> {
        return new Promise((resolve) => {
            (<GDBConnection>this.connectionList[ConnectionIndex.GDB]).Send('info stack').then((frames) => {

                let stackList: DebugProtocol.StackFrame[] = [];

                if (frames) {
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
                }

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

                if (valList) {
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
                }

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

                try {
                    v.value = 'array [' + (<any[]>JSON.parse(expr.val)).length.toString() + ']';

                    child = new Variable('_obj', expr.val);
                    child.type = 'array';

                    v.variablesReference = vHandler.create(child);

                } catch (error) {

                    v.value = 'array <parse error> : ' + expr.val;

                    v.variablesReference = 0;
                }
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

                child = new Variable('_obj', expr.val);
                child.type = 'object';

                v.variablesReference = vHandler.create(child);
                break;
            case 'original':
                v.type = 'original value';
                v.value = expr.val;
                break;
            default:
                console.warn('unknown expr type: ' + expr.dataType);
                break;
        }

        return v;
    }

    private GetDataType(val: string): DataType {

        const reg_integer = /^-?\s*[0-9]+$/;
        const reg_hex = /^(?:0x|0X)[0-9a-fA-F]+$/;
        const reg_float = /^-?\s*[0-9]+\.[0-9]+$/;
        const objReg = /^\s*(\{\s*\w+\s*=.+\})\s*$/;

        val = val.trim();

        if (reg_integer.test(val) || reg_hex.test(val)) {
            return 'integer';
        }

        if (reg_float.test(val)) {
            return 'float';
        }

        if (objReg.test(val)) {
            return 'object';
        }

        return 'original';
    }

    async getLocal(vHandler: VariablesHandles): Promise<DebugProtocol.Variable[]> {
        return new Promise((resolve) => {
            (<GDBConnection>this.connectionList[ConnectionIndex.GDB]).Send('info locals').then((valList) => {

                let variablesList: DebugProtocol.Variable[] = [];

                if (valList) {
                    valList.forEach((v) => {
                        variablesList.push(this.ExpressionToVariables(vHandler, v));
                    });
                }

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

            let varList = await (<GDBConnection>this.connectionList[ConnectionIndex.GDB]).Send('info variables');

            if (varList) {
                this.globalVariables = varList;
            } else {
                this.globalVariables = [];
            }

            resolve();
        });
    }

    async getGlobal(vHandler: Handles<DebugProtocol.Variable>): Promise<DebugProtocol.Variable[]> {
        return new Promise(async (resolve) => {
            let list: DebugProtocol.Variable[] = [];
            let expr: NotifyData<Expression[]>;

            for (let i = 0; i < this.globalVariables.length; i++) {
                expr = await (<GDBConnection>this.connectionList[ConnectionIndex.GDB]).Send('print', this.globalVariables[i].name);
                if (expr && expr.length > 0) {
                    expr[0].name = expr[0].name.replace(/\$\w+/g, this.globalVariables[i].name);
                    list.push(this.ExpressionToVariables(vHandler, expr[0]));
                }
            }

            resolve(list);
        });
    }

    async readMemory(name: string, address: number): Promise<DebugProtocol.Variable> {

        return new Promise((resolve) => {

            (<GDBConnection>this.connectionList[ConnectionIndex.GDB]).Send('x', '0x' + address.toString(16)).then((expr) => {
                if (expr) {
                    resolve(new Variable(name, expr.val, 0));
                } else {
                    resolve(new Variable(name, 'null', 0));
                }
            });
        });
    }

    CreateSource(_path: string): Source {
        return new Source(Path.basename(_path), this.DelRepeat(_path));
    }

    private DelRepeat(path: string): string {

        const _path = File.ToUnixPath(path)
            .replace(/\/{2,}/g, '/')
            .replace(/\.\//g, '')
            .replace(/\/$/, '');

        if (File.sep === '/') {
            return _path;
        }

        return _path.replace(/\//g, File.sep);
    }
}