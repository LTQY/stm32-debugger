import * as vscode from 'vscode';
import {
    Logger, logger, LoggingDebugSession, StoppedEvent, BreakpointEvent,
    InitializedEvent, TerminatedEvent,
    Thread, StackFrame, Scope, Source, Handles, Variable, ContinuedEvent, OutputEvent
} from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { Runtime, VariablesHandles, LaunchRequestArguments, RuntimeStatus } from './Runtime';
import { GlobalEvent } from './GlobalEvents';
import { EventEmitter } from 'events';
import * as path from 'path';

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

    private _configurationDone = new Subject();

    constructor() {

        super();

        this.status = RuntimeStatus.Stopped;

        // this debugger uses zero-based lines and columns
        this.setDebuggerLinesStartAt1(false);
        this.setDebuggerColumnsStartAt1(false);

        this._runtime = new Runtime();

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
        this._runtime.on('output', (data: { line: string, type: string | undefined }) => {
            const e = new OutputEvent(data.line + '\n', data.type);
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

    protected async launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments) {

        // wait until configuration has finished (and configurationDoneRequest has been called)

        this.status = RuntimeStatus.Running;

        await this._configurationDone.wait();

        await this._runtime.Init(args);

        // start the program in the runtime
        await this._runtime.start();

        this.sendResponse(response);

        this._runtime.continue();
    }

    protected async restartRequest(response: DebugProtocol.RestartResponse, args: DebugProtocol.RestartArguments) {
        this.sendResponse(response);
    }

    protected async setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments) {

        const clientLines = args.lines || [];
        response.body = {
            breakpoints: []
        };

        let path: string = args.source.path ? args.source.path : args.source.name ? args.source.name : '';

        if (path === '') {
            throw Error('Set breakpoints on a invalid file path !');
        }

        if (this._runtime.GetStatus() === RuntimeStatus.Stopped) {

            this._runtime.PreSetBreakpoints(path, clientLines).forEach((bp: any) => {
                bp.lines.forEach((line: number) => {
                    response.body.breakpoints.push({
                        source: this.CreateSource(bp.path),
                        line: line,
                        verified: false
                    });
                });
            });

            this.sendResponse(response);

        } else {

            await this._runtime.clearBreakpoints(path);

            this._runtime.setBreakpoints(path, clientLines).then((values) => {

                values.forEach((bp) => {
                    if (bp.id) {
                        response.body.breakpoints.push({
                            id: bp.id,
                            line: bp.lineNum,
                            verified: bp.verified,
                            source: this.CreateSource(path)
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

        const scopes = new Array<Scope>();

        await this._runtime.InitGlobalVariables();

        scopes.push(new Scope("Local", this._variableHandles.create(<Variable>{ name: 'Local', variablesReference: STM32DebugAdapter.ScopeFlag }), false));
        scopes.push(new Scope("Global", this._variableHandles.create(<Variable>{ name: 'Global', variablesReference: STM32DebugAdapter.ScopeFlag }), true));
        scopes.push(new Scope("Register", this._variableHandles.create(<Variable>{ name: 'Register', variablesReference: STM32DebugAdapter.ScopeFlag }), true));

        response.body = {
            scopes: scopes
        };
        this.sendResponse(response);
    }

    protected variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): void {

        const value = this._variableHandles.get(args.variablesReference);

        if (value.variablesReference == STM32DebugAdapter.ScopeFlag) {
            switch (value.name) {
                case 'Local':
                    this._runtime.getLocal(this._variableHandles).then((variables) => {
                        response.body = {
                            variables: variables
                        };
                        this.sendResponse(response);
                    });
                    break;
                case 'Global':
                    this._runtime.getGlobal(this._variableHandles).then((variables) => {
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
                        name: 'real',
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
                        name: 'real',
                        type: 'object',
                        value: JSON.stringify(v),
                        variablesReference: 0
                    }) : 0;

                    vList.push(variables);
                });
                break;
            default:
                GlobalEvent.emit('msg', {
                    type: 'Warning',
                    contentType: 'string',
                    content: 'Unknown value.type \'' + value.type + '\'',
                    className: STM32DebugAdapter.name,
                    methodName: this.GetVariables.name
                });
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

    private CreateSource(_path: string): Source {
        return new Source(path.basename(_path), this.convertDebuggerPathToClient(_path));
    }
}