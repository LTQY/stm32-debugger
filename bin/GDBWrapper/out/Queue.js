"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class Queue {
    constructor() {
        this.list = [];
    }
    Dequeue() {
        if (this.IsEmpty()) {
            return null;
        }
        return this.list.splice(0, 1)[0];
    }
    Enqueue(val) {
        this.list.push(val);
        return this.list.length;
    }
    First() {
        if (this.IsEmpty()) {
            return null;
        }
        return this.list[0];
    }
    IsEmpty() {
        return this.list.length === 0;
    }
    Size() {
        return this.list.length;
    }
}
exports.Queue = Queue;
//# sourceMappingURL=Queue.js.map