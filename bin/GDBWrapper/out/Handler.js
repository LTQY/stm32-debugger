"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Process = require("child_process");
const GDBProtocol_1 = require("./GDBProtocol");
const ReadLine = require("readline");
const GlobalEvents_1 = require("./GlobalEvents");
const events_1 = require("events");
const CommandQueue_1 = require("./CommandQueue");
const GDBTextParser_1 = require("./GDBTextParser");
let emitter = new events_1.EventEmitter();
let activeEnd = false;
let cNum = 0;
const maxNum = 1;
function HandlePort_1122(socket) {
    socket.on('data', (buf) => {
        let str = buf.toString('utf8');
        let msgList = str.split(GDBProtocol_1.tcpDataSeparator);
        msgList.forEach((str) => {
            if (str.trim() !== '') {
                let tData = JSON.parse(str);
                GlobalEvents_1.GlobalEvent.emit('log', { line: '[request] : ' + str });
                switch (tData.tag) {
                    case 'Debug':
                        HandleDebug(JSON.parse(tData.data));
                        break;
                    default:
                        GlobalEvents_1.GlobalEvent.emit('msg', {
                            type: 'Warning',
                            contentType: 'string',
                            content: 'UnknownMsg : ' + tData.tag
                        });
                        break;
                }
            }
        });
    });
    GlobalEvents_1.GlobalEvent.on('msg', (msg) => {
        switch (msg.type) {
            case 'Error':
                {
                    const tcpData = {
                        tag: 'error',
                        data: JSON.stringify(msg)
                    };
                    activeEnd = true;
                    socket.end(JSON.stringify(tcpData) + GDBProtocol_1.tcpDataSeparator);
                }
                break;
            default:
                break;
        }
    });
    GlobalEvents_1.GlobalEvent.on('debugger-abort', (msg) => {
        const tcpData = {
            tag: 'close',
            data: msg
        };
        activeEnd = true;
        socket.end(JSON.stringify(tcpData) + GDBProtocol_1.tcpDataSeparator);
    });
    emitter.on('Debug_Response', (data) => {
        const response = JSON.stringify(data);
        socket.write(response + GDBProtocol_1.tcpDataSeparator);
        GlobalEvents_1.GlobalEvent.emit('log', { line: '[PostResponse] : ' + response });
    });
    socket.on('end', () => {
        if (!activeEnd) {
            socket.end();
        }
        socket.destroy();
        if (debugProc && !debugProc.killed) {
            debugProc.kill('SIGKILL');
        }
        GlobalEvents_1.GlobalEvent.emit('Request_Close');
    });
    if (cNum < maxNum) {
        cNum++;
    }
    else {
        socket.end();
        activeEnd = true;
    }
}
exports.HandlePort_1122 = HandlePort_1122;
//------Debug------
let debugProc = null;
const exeQueue = new CommandQueue_1.ExecutableQueue();
exeQueue.OnRunNewOne = RunCmd;
let debugIO;
let isCommandRunning;
let resultList;
let gdbParser = new GDBTextParser_1.GDBTextParser();
function HandleDebug(content) {
    switch (content.command) {
        case 'init':
            {
                Debug_start().then(() => {
                    SendResponse({
                        command: 'init',
                        status: { isDone: true }
                    });
                    const elfPath = '"' + content.data.replace(/\\/g, '\\\\') + '"';
                    exeQueue.Execute('file', elfPath);
                }, (err) => {
                    GlobalEvents_1.GlobalEvent.emit('error', err);
                });
            }
            break;
        case 'launch':
            exeQueue.startGroup('target remote', { groupName: content.command }, 'localhost:2331');
            exeQueue.groupAdd('monitor reset', { groupName: content.command });
            exeQueue.groupAdd('load', { groupName: content.command });
            exeQueue.endGroup('undisplay', { groupName: content.command }, 'y');
            break;
        case 'break':
            {
                const bp = JSON.parse(content.data);
                exeQueue.Execute('break', '"' + bp.source + '":' + bp.lineNum + (bp.isCondition ? ' if ' + bp.condition : ''));
            }
            break;
        case 'break main':
            exeQueue.Execute('break', 'main');
            break;
        case 'delete breakpoints':
            {
                const bp = JSON.parse(content.data);
                if (bp.id) {
                    exeQueue.Execute('delete breakpoints', bp.id.toString(10), { name: 'delete breakpoints' });
                }
            }
            break;
        case 'pause':
            exeQueue.Execute('monitor halt', undefined, { name: 'pause' });
            exeQueue.Execute(GDBProtocol_1.BpHitCommand);
            break;
        case 'continue':
            exeQueue.Execute('continue');
            exeQueue.Execute(GDBProtocol_1.BpHitCommand);
            break;
        case 'stop':
            exeQueue.Execute(String.fromCharCode(3), undefined, { name: 'stop' });
            break;
        case 'step':
            exeQueue.Execute('step');
            exeQueue.Execute(GDBProtocol_1.BpHitCommand);
            break;
        case 'step over':
            exeQueue.Execute('n', undefined, { name: 'step over' });
            exeQueue.Execute(GDBProtocol_1.BpHitCommand);
            break;
        case 'info locals':
            exeQueue.Execute('info locals');
            break;
        case 'info variables':
            exeQueue.Execute('info variables');
            break;
        case 'info stack':
            exeQueue.Execute('info stack');
            break;
        case 'print':
            exeQueue.Execute('print', content.data);
            break;
        case 'set':
            exeQueue.Execute('set var', content.data, { name: 'set' });
            break;
        case 'info registers':
            exeQueue.Execute('info registers');
            break;
        case 'x': // x /1xw
            exeQueue.Execute('x', '/1xw ' + content.data);
            break;
        default:
            GlobalEvents_1.GlobalEvent.emit('msg', {
                type: 'Warning',
                contentType: 'string',
                content: 'Unknown command \'' + content.command + '\''
            });
            break;
    }
}
function RunCmd(command, params, option) {
    GlobalEvents_1.GlobalEvent.emit('log', { line: '[RunCommand] : ' + command + params });
    if (command !== GDBProtocol_1.BpHitCommand) {
        debugProc.stdin.write(command + params, 'ascii');
    }
}
const gdbWaitMatcher = new RegExp(/^\(gdb\)\s*$/);
const errorMatcher = {
    'disconnect': /Remote communication error\./i
};
function Debug_start() {
    return new Promise((resolve, reject) => {
        let exePath = process.cwd() + '\\res\\ARM-GNU-Tool\\bin\\arm-none-eabi-gdb.exe';
        debugProc = Process.execFile(exePath, ['--interpreter', 'mi'], { windowsHide: true });
        isCommandRunning = false;
        resultList = [];
        debugProc.stdout.setEncoding('utf8');
        debugProc.stderr.setEncoding('utf8');
        debugIO = ReadLine.createInterface({ input: debugProc.stdout });
        debugProc.on('error', (err) => {
            SendResponse({
                command: 'init',
                status: { isDone: false, msg: JSON.stringify(err) }
            });
            reject(err);
        });
        debugIO.on('line', (line) => {
            GlobalEvents_1.GlobalEvent.emit('log', { line: '[Line] : ' + line });
            for (let key in errorMatcher) {
                if (errorMatcher[key].test(line)) {
                    GlobalEvents_1.GlobalEvent.emit('debugger-abort', line);
                    break;
                }
            }
            if (gdbWaitMatcher.test(line)) {
                if (isCommandRunning) {
                    DebugResponse();
                }
                else {
                    isCommandRunning = true;
                    resolve();
                }
            }
            else if (isCommandRunning) {
                resultList.push(line);
            }
        });
    });
}
let _groupRes;
function DebugResponse() {
    const command = exeQueue.CurrentCommand();
    let res;
    try {
        res = gdbParser.Parse(command, resultList);
    }
    catch (error) {
        GlobalEvents_1.GlobalEvent.emit('log', { line: '[Error] : ' + error });
    }
    if (res === undefined) {
        res = {
            command: command,
            result: [],
            status: {
                isDone: false
            }
        };
    }
    resultList = [];
    switch (exeQueue.GetStatus()) {
        case CommandQueue_1.CommandStatus.GROUP_START:
            {
                _groupRes = {
                    command: exeQueue.CurrentGroup(),
                    status: {
                        isDone: res.status.isDone,
                        msg: res.status.msg
                    }
                };
            }
            break;
        case CommandQueue_1.CommandStatus.GROUP_RUNNING:
            {
                if (_groupRes.status.isDone) {
                    _groupRes.status.isDone = res.status.isDone;
                }
                if (!_groupRes.status.msg) {
                    _groupRes.status.msg = res.status.msg;
                }
            }
            break;
        case CommandQueue_1.CommandStatus.GROUP_END:
            {
                if (_groupRes.status.isDone) {
                    _groupRes.status.isDone = res.status.isDone;
                }
                if (!_groupRes.status.msg) {
                    _groupRes.status.msg = res.status.msg;
                }
                SendResponse(_groupRes);
            }
            break;
        default:
            SendResponse(res);
            break;
    }
    exeQueue.NotifyRunNext();
}
function SendResponse(response) {
    GlobalEvents_1.GlobalEvent.emit('log', { line: '[SendResponse] : ' + response.command });
    emitter.emit('Debug_Response', {
        tag: 'Debug',
        data: JSON.stringify(response)
    });
}
//# sourceMappingURL=Handler.js.map