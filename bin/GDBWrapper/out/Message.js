"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function ExceptionToMessage(err) {
    return {
        type: 'Error',
        contentType: 'exception',
        content: JSON.stringify({
            name: err.name,
            message: err.message,
            stack: err.stack
        })
    };
}
exports.ExceptionToMessage = ExceptionToMessage;
//# sourceMappingURL=Message.js.map