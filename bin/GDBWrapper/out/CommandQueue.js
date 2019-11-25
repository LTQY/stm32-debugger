"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Queue_1 = require("./Queue");
const events_1 = require("events");
const GlobalEvents_1 = require("./GlobalEvents");
var CommandStatus;
(function (CommandStatus) {
    CommandStatus[CommandStatus["GROUP_START"] = 0] = "GROUP_START";
    CommandStatus[CommandStatus["GROUP_RUNNING"] = 1] = "GROUP_RUNNING";
    CommandStatus[CommandStatus["GROUP_END"] = 2] = "GROUP_END";
    CommandStatus[CommandStatus["NORMAL"] = 3] = "NORMAL";
})(CommandStatus = exports.CommandStatus || (exports.CommandStatus = {}));
class ExecutableQueue extends events_1.EventEmitter {
    constructor() {
        super();
        this.status = CommandStatus.NORMAL;
        this._queue = new Queue_1.Queue();
        this._group = '';
        this.runFirst = true;
    }
    RunNext() {
        if (!this._queue.IsEmpty()) {
            const v = this._queue.First();
            if (v.option && v.option.groupName && v.option.tag) {
                switch (v.option.tag) {
                    case 'group-start':
                        this._group = v.option.groupName;
                        this.status = CommandStatus.GROUP_START;
                        GlobalEvents_1.GlobalEvent.emit('log', { line: '[ExecutableQueue] : GROUP_START : \'' + this._group + '\'' });
                        break;
                    case 'group-running':
                        this.status = CommandStatus.GROUP_RUNNING;
                        break;
                    case 'group-end':
                        this.status = CommandStatus.GROUP_END;
                        GlobalEvents_1.GlobalEvent.emit('log', { line: '[ExecutableQueue] : GROUP_END : \'' + this._group + '\'' });
                        break;
                    default:
                        break;
                }
            }
            else {
                this.status = CommandStatus.NORMAL;
            }
            if (!this.OnRunNewOne) {
                GlobalEvents_1.GlobalEvent.emit('error', new Error('Function \'OnRunNewOne\' is undefined !'));
            }
            else {
                GlobalEvents_1.GlobalEvent.emit('log', { line: '[ExecutableQueue] : Run \'' + v.command + '\'' });
                this.OnRunNewOne(v.command, v.params, v.option);
            }
        }
        else {
            this.runFirst = true;
        }
    }
    Execute(command, params, option) {
        this._queue.Enqueue({
            command: command,
            params: (params ? ' ' + params : '') + '\n',
            option: option
        });
        GlobalEvents_1.GlobalEvent.emit('log', { line: '[ExecutableQueue] : Add \'' + command + '\'' });
        if (this.runFirst) {
            this.runFirst = false;
            this.RunNext();
        }
    }
    CurrentCommand() {
        const v = this._queue.First();
        if (v) {
            return v.option ? (v.option.name ? v.option.name : v.command) : v.command;
        }
        else {
            throw new Error('Has no command');
        }
    }
    CurrentGroup() {
        const v = this._queue.First();
        if (v && v.option && v.option.groupName) {
            return v.option.groupName;
        }
        return undefined;
    }
    GetStatus() {
        return this.status;
    }
    startGroup(command, option, params) {
        option.tag = 'group-start';
        this.Execute(command, params, option);
    }
    groupAdd(command, option, params) {
        option.tag = 'group-running';
        this.Execute(command, params, option);
    }
    endGroup(command, option, params) {
        option.tag = 'group-end';
        this.Execute(command, params, option);
    }
    NotifyRunNext() {
        this._queue.Dequeue();
        this.RunNext();
    }
}
exports.ExecutableQueue = ExecutableQueue;
//# sourceMappingURL=CommandQueue.js.map