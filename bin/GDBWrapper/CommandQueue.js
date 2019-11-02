"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Queue_1 = require("./Queue");
const events_1 = require("events");
const GlobalEvents_1 = require("./GlobalEvents");
class ExecutableQueue extends events_1.EventEmitter {
    constructor() {
        super();
        this._queue = new Queue_1.Queue();
        this.runFirst = true;
    }
    RunNext() {
        if (!this._queue.IsEmpty()) {
            const v = this._queue.First();
            if (this.OnRunNewOne) {
                GlobalEvents_1.GlobalEvent.emit('log', { line: '[ExecutableQueue] : Run \'' + v.command + '\'' });
                this.OnRunNewOne(v.command, v.params, v.key);
            }
            else {
                GlobalEvents_1.GlobalEvent.emit('error', new Error('Function \'OnRunNewOne\' is undefined !'));
            }
        }
        else {
            this.runFirst = true;
        }
    }
    Execute(command, params, key) {
        this._queue.Enqueue({
            command: command,
            params: (params ? ' ' + params : '') + '\n',
            key: key
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
            return v.command;
        }
        else {
            throw new Error('Has no command');
        }
    }
    NotifyRunNext() {
        this._queue.Dequeue();
        this.RunNext();
    }
}
exports.ExecutableQueue = ExecutableQueue;
//# sourceMappingURL=CommandQueue.js.map