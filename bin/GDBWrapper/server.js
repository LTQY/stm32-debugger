"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const net = require("net");
const Handler = require("./Handler");
const GlobalEvents_1 = require("./GlobalEvents");
const File_1 = require("./File");
const file = new File_1.File(process.argv[1]);
process.chdir(file.dir);
const server = net.createServer((socket) => {
    Handler.HandlePort_1122(socket);
});
server.on('error', (err) => {
    GlobalEvents_1.GlobalEvent.emit('msg', {
        type: 'Error',
        contentType: 'object',
        content: JSON.stringify(err)
    });
    console.error(err);
});
server.on('close', () => {
    console.log('Close', 'GDBServer closed!');
    GlobalEvents_1.GlobalEvent.emit('Server_Close');
});
server.listen(1122, 'localhost', () => {
    console.log('[GDBServer] : start!');
    GlobalEvents_1.GlobalEvent.emit('Server_Launched');
});
GlobalEvents_1.GlobalEvent.on('Request_Close', () => {
    server.close();
});
//# sourceMappingURL=server.js.map