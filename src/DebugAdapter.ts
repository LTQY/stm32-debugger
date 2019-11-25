import {
    LoggingDebugSession, StoppedEvent, BreakpointEvent,
    InitializedEvent, TerminatedEvent,
    Scope, Source, Variable, ContinuedEvent, OutputEvent
} from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { Runtime, VariablesHandles, LaunchRequestArguments, RuntimeStatus, DebugOutputData } from './Runtime';
import { GlobalEvent } from './GlobalEvents';
import { EventEmitter } from 'events';
import { SVDParer, Peripheral } from './SVDParser';
import { File } from '../lib/node-utility/File';
import { parse_svdFile_failed, parse_svdFile_warning } from './StringTable';
import { BaseBreakPoint } from './GDBProtocol';

class Subject {

    private _event: EventEmitter;

    constructor() {
        this._event = new EventEmitter();
    }

    notify() {
        this._event.emit('done');
    }

    async wait(): Promise<void> {
        return new Promise((resolve) => {
            this._event.once('done', () => {
                resolve();
            });
        });
    }
}

export class STM32DebugAdapter extends LoggingDebugSession {

    private static ScopeFlag = 1;

    private _runtime: Runtime;

    private status: RuntimeStatus;

    private _variableHandles = new VariablesHandles(10);

    private _variablesList: Variable[];

    private _configurationDone = new Subject();

    private _svdParser: SVDParer;

    constructor() {

        super();

        this._variablesList = [];

        this.status = RuntimeStatus.Stopped;

        // this debugger uses zero-based lines and columns
        this.setDebuggerLinesStartAt1(false);
        this.setDebuggerColumnsStartAt1(false);

        this._runtime = new Runtime();

        this._svdParser = new SVDParer();

        //StoppedEvent: 'step', 'breakpoint', 'exception', 'pause', 'entry', 'goto', 'function breakpoint', 'data breakpoint', etc.

        // setup event handlers
        this._runtime.on('stopOnEntry', (threadID) => {
            this.sendEvent(new StoppedEvent('entry', threadID));
        });
        this._runtime.on('stopOnStep', (threadID) => {
            this.sendEvent(new StoppedEvent('step', threadID));
        });
        this._runtime.on('pause', (threadID) => {
            this.sendEvent(new StoppedEvent('pause', threadID));
        });
        this._runtime.on('stopOnBreakpoint', (threadID) => {
            this.sendEvent(new StoppedEvent('breakpoint', threadID));
        });
        this._runtime.on('stopOnDataBreakpoint', (threadID) => {
            this.sendEvent(new StoppedEvent('data breakpoint', threadID));
        });
        this._runtime.on('stopOnException', (threadID) => {
            this.sendEvent(new StoppedEvent('exception', threadID));
        });
        this._runtime.on('breakpointValidated', (bp) => {
            this.sendEvent(new BreakpointEvent('changed', bp));
        });
        this._runtime.once('close', () => {
            if (RuntimeStatus.Running === this.status) {
                this.sendEvent(new TerminatedEvent());
            }
        });
        this._runtime.on('continue', (threadID) => {
            this.sendEvent(new ContinuedEvent(threadID, false));
        });
        this._runtime.on('output', (data: DebugOutputData) => {
            const e = new OutputEvent(data.txt + '\n', data.type);
            this.sendEvent(e);
        });
    }

    /**
	 * The 'initialize' request is the first request called by the frontend
	 * to interrogate the features the debug adapter provides.
	 */
    protected async initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments) {

        // build and return the capabilities of this debug adapter:
        response.body = response.body || {};
        // the adapter implements the configurationDoneRequest.
        response.body.supportsConfigurationDoneRequest = true;
        // make VS Code to use 'evaluate' when hovering over source
        response.body.supportsTerminateRequest = true;

        response.body.supportTerminateDebuggee = true;

        response.body.supportsEvaluateForHovers = true;

        response.body.supportsConditionalBreakpoints = true;

        response.body.supportsRestartRequest = true;

        //this.status = RuntimeStatus.Running;

        let done: boolean | undefined = await this._runtime.Connect();

        if (done) {

            this.sendResponse(response);

            this.sendEvent(new InitializedEvent());

        } else {

            this.sendEvent(new TerminatedEvent());

        }
    }

    protected terminateRequest(response: DebugProtocol.TerminateResponse, args: DebugProtocol.TerminateArguments): void {
        this.status = RuntimeStatus.Stopped;
        this.sendResponse(response);
    }

    protected async disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments) {
        await this._runtime.Disconnect();
        this.sendResponse(response);
        this.shutdown();
    }

	/**
	 * Called at the end of the configuration sequence.
	 * Indicates that all breakpoints etc. have been sent to the DA and that the 'launch' can start.
	 */
    protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
        super.configurationDoneRequest(response, args);

        // notify the launchRequest that configuration has finished
        setTimeout(() => {
            this._configurationDone.notify();
        }, 500);
    }

    private LoadSVDInfo(path?: string) {
        if (path) {
            const svdFile = new File(path);
            if (svdFile.IsFile()) {
                try {
                    if (!this._svdParser.Parse(svdFile)) {
                        GlobalEvent.emit('msg', {
                            type: 'Warning',
                            contentType: 'string',
                            content: parse_svdFile_warning + svdFile.path
                        });
                    }
                } catch (error) {

                    console.error(error);

                    GlobalEvent.emit('msg', {
                        type: 'Warning',
                        contentType: 'string',
                        content: parse_svdFile_failed + svdFile.path
                    });
                }
            }
        }
    }

    protected async launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments) {

        // wait until configuration has finished (and configurationDoneRequest has been called)

        this.status = RuntimeStatus.Running;

        await this._configurationDone.wait();

        await this._runtime.Init(args);

        this.LoadSVDInfo(args.svdPath);

        // start the program in the runtime
        await this._runtime.start();

        this.sendResponse(response);

        this._runtime.continue();
    }

    protected async restartRequest(response: DebugProtocol.RestartResponse, args: DebugProtocol.RestartArguments) {
        this.sendResponse(response);
    }

    protected async setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments) {

        const _lines = args.lines || [];

        response.body = {
            breakpoints: []
        };

        let path: string = args.source.path || args.source.name || '';

        if (path === '') {
            this.sendResponse(response);
            console.warn('Set breakpoints on a invalid file path !');
            return;
        }

        const _source = this._runtime.CreateSource(path);

        if (this._runtime.GetStatus() === RuntimeStatus.Stopped) {

            this._runtime.PreSetBreakpoints(_source.path, _lines).forEach((bp) => {
                response.body.breakpoints.push({
                    id: 0,
                    source: this._runtime.CreateSource(bp.source),
                    line: bp.lineNum,
                    verified: true
                });
            });

            this.sendResponse(response);

        } else {

            await this._runtime.clearBreakpoints(_source.path);

            this._runtime.setBreakpoints(_source.path, _lines).then((res) => {

                res.forEach((bp) => {
                    if (bp.id) {
                        response.body.breakpoints.push({
                            id: bp.id,
                            line: bp.lineNum,
                            verified: bp.verified,
                            source: _source
                        });
                    }
                });

                this.sendResponse(response);
            });
        }
    }

    protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {

        this._runtime.getThreads().then((threads) => {
            response.body = {
                threads: threads
            };
            this.sendResponse(response);
        });
    }

    protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {

        const startFrame = typeof args.startFrame === 'number' ? args.startFrame : 0;
        const maxLevels = typeof args.levels === 'number' ? args.levels : 1000;
        const endFrame = startFrame + maxLevels;

        this._runtime.stack(startFrame, endFrame).then((stack) => {
            response.body = {
                stackFrames: stack,
                totalFrames: stack.length
            };
            this.sendResponse(response);
        });
    }

    protected async scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments) {

        await this._runtime.InitGlobalVariables();

        const scopes: Scope[] = [];

        scopes.push(new Scope("Local", this._variableHandles.create(<Variable>{ name: 'Local', variablesReference: STM32DebugAdapter.ScopeFlag }), false));
        scopes.push(new Scope("Global", this._variableHandles.create(<Variable>{ name: 'Global', variablesReference: STM32DebugAdapter.ScopeFlag }), true));
        scopes.push(new Scope("Register", this._variableHandles.create(<Variable>{ name: 'Register', variablesReference: STM32DebugAdapter.ScopeFlag }), true));
        scopes.push(new Scope("Peripherals", this._variableHandles.create(<Variable>{ name: 'Peripherals', variablesReference: STM32DebugAdapter.ScopeFlag }), true));

        response.body = {
            scopes: scopes
        };
        this.sendResponse(response);
    }

    protected variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): void {

        const value = this._variableHandles.get(args.variablesReference);

        if (value.variablesReference == STM32DebugAdapter.ScopeFlag) {

            this.ClearVariables();

            switch (value.name) {
                case 'Local':
                    this._runtime.getLocal(this._variableHandles).then((variables) => {

                        this.AddVariables(variables);

                        response.body = {
                            variables: variables
                        };
                        this.sendResponse(response);
                    });
                    break;
                case 'Global':
                    this._runtime.getGlobal(this._variableHandles).then((variables) => {

                        this.AddVariables(variables);

                        response.body = {
                            variables: variables
                        };
                        this.sendResponse(response);
                    });
                    break;
                case 'Register':
                    this._runtime.getRegister().then((variables) => {
                        response.body = {
                            variables: variables
                        };
                        this.sendResponse(response);
                    });
                    break;
                case 'Peripherals':
                    this.getPeripherals(this._svdParser.GetPeripheralList()).then((vars) => {
                        response.body = {
                            variables: vars
                        };
                        this.sendResponse(response);
                    });
                    break;
                default:
                    response.body = {
                        variables: []
                    };
                    this.sendResponse(response);
                    break;
            }
        } else {
            response.body = {
                variables: this.GetVariables(this._variableHandles, args)
            };
            this.sendResponse(response);
        }
    }

    private _rGetBitMask(bitNum: number): number {
        let bit = 0;

        for (let i = 0; i < bitNum; i++) {
            bit = (bit << 1) + 1;
        }

        return bit;
    }

    private async getPeripherals(perList: Peripheral[]): Promise<DebugProtocol.Variable[]> {

        return new Promise(async (resolve) => {

            const variables: Variable[] = [];

            for (let _per of perList) {

                const regVariablesList: Variable[] = [];
                const perVariables: DebugProtocol.Variable = new Variable(_per.name, '', 0);

                for (let reg of _per.registers) {

                    const _var = await this._runtime.readMemory(reg.name, _per.baseAddr + reg.offset);

                    if (_var.value !== 'null') {

                        _var.type = 'fieldArray';

                        const fieldList: { name: string, val: string }[] = [];
                        const _v = parseInt(_var.value);

                        for (let field of reg.fields) {

                            const fieldVal: number = (_v >> (field.bitOffset)) & this._rGetBitMask(field.size);

                            fieldList.push({
                                name: field.name,
                                val: '0x' + fieldVal.toString(16)
                            });
                        }

                        _var.variablesReference = this._variableHandles.create({
                            name: '_obj',
                            type: 'fieldArray',
                            value: JSON.stringify(fieldList),
                            variablesReference: 0
                        });
                    } else {

                        _var.type = 'integer';
                    }

                    regVariablesList.push(_var);
                }

                perVariables.value = 'address: 0x' + _per.baseAddr.toString(16);

                perVariables.variablesReference = this._variableHandles.create({
                    name: '_obj',
                    type: 'peripheralArray',
                    value: JSON.stringify(regVariablesList),
                    variablesReference: 0
                });

                variables.push(perVariables);
            }

            resolve(variables);
        });
    }

    private AddVariables(_variables: Variable[]) {
        this._variablesList = this._variablesList.concat(_variables);
    }

    private ClearVariables() {
        this._variablesList = [];
    }

    private _GetRealVariables(v: Variable): Variable | undefined {

        let _var: Variable = v;

        while (_var && _var.variablesReference !== 0) {
            _var = this._variableHandles.get(_var.variablesReference);
        }

        return _var;
    }

    private SearchVariableByExpr(expression: string): Variable | undefined {

        const nameList: string[] = expression.split('.');
        let vStack: Variable[][] = [];
        vStack.push(this._variablesList);

        let res: Variable | undefined;
        let temp: Variable[];
        let nIndex: number = 0, vIndex: number;

        while (vStack.length > 0 && nIndex < nameList.length) {

            temp = <Variable[]>vStack.pop();
            vIndex = temp.findIndex(v => { return v.name === nameList[nIndex]; });
            if (vIndex !== -1) {
                res = this._GetRealVariables(temp[vIndex]);
                if (res) {
                    try {
                        const obj = JSON.parse(res.value);
                        let nList: Variable[] = [];
                        for (let key in obj) {
                            nList.push(new Variable(key, JSON.stringify(obj[key]), 0));
                        }
                        vStack.push(nList);
                    } catch (error) {
                        // do nothing
                    }
                }
            } else {
                res = undefined;
            }

            nIndex++;
        }

        return res;
    }

    private GetVariables(_handles: VariablesHandles, args: DebugProtocol.VariablesArguments): DebugProtocol.Variable[] {

        const value = this._variableHandles.get(args.variablesReference);
        let vList: DebugProtocol.Variable[] = [];
        let data = JSON.parse(value.value);
        let variables: DebugProtocol.Variable;

        switch (value.type) {
            case 'object':
                for (let key in data) {
                    variables = new Variable(key, '');
                    let v = data[key];

                    variables.type = typeof v === 'number' ? (Number.isInteger(v) ? 'integer' : 'float') :
                        (typeof v === 'string' ? 'string' : 'object');
                    variables.value = variables.type === 'string' ? v : (variables.type === 'object' ? 'Object ' + JSON.stringify(v) : v.toString());
                    variables.variablesReference = variables.type === 'object' ? _handles.create({
                        name: '_obj',
                        type: 'object',
                        value: JSON.stringify(v),
                        variablesReference: 0
                    }) : 0;

                    vList.push(variables);
                }
                break;
            case 'array':
                (<any[]>data).forEach((v, index) => {

                    variables = new Variable(index.toString(), '');

                    variables.type = typeof v === 'number' ? (Number.isInteger(v) ? 'integer' : 'float') :
                        (typeof v === 'string' ? 'string' : 'object');
                    variables.value = variables.type === 'string' ? v : (variables.type === 'object' ? 'Object ' + JSON.stringify(v) : v.toString());
                    variables.variablesReference = variables.type === 'object' ? _handles.create({
                        name: '_obj',
                        type: 'object',
                        value: JSON.stringify(v),
                        variablesReference: 0
                    }) : 0;

                    vList.push(variables);
                });
                break;
            case 'peripheralArray':
                (<Variable[]>data).forEach((v) => {

                    variables = new Variable(v.name, v.value, v.variablesReference);

                    variables.type = 'array';

                    vList.push(variables);
                });
                break;
            case 'fieldArray':
                (<{ name: string, val: string }[]>data).forEach((v) => {

                    variables = new Variable(v.name, v.val, 0);

                    variables.type = 'integer';

                    vList.push(variables);
                });
                break;
            default:
                console.warn('unknown expr type: ' + value.type);
                break;
        }

        return vList;
    }

    protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
        this._runtime.continue().then(() => {
            this.sendResponse(response);
        });
    }

    protected async stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments) {
        await this._runtime.step();
        this.sendResponse(response);
    }

    protected async stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments) {
        await this._runtime.stepOver();
        this.sendResponse(response);
    }

    protected async nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments) {
        await this._runtime.stepOver();
        this.sendResponse(response);
    }

    protected async pauseRequest(response: DebugProtocol.PauseResponse, args: DebugProtocol.PauseArguments) {
        await this._runtime.pause();
        this.sendResponse(response);
    }

    protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void {
        if (args.context === 'hover') {
            let _var = this.SearchVariableByExpr(args.expression);
            if (_var) {
                response.body = {
                    result: _var.value,
                    variablesReference: _var.variablesReference,
                    presentationHint: {
                        kind: 'property'
                    }
                };
                this.sendResponse(response);
            }
        }
    }
}