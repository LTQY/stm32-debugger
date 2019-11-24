"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const net = require("net");
const Handler = require("./Handler");
const GlobalEvents_1 = require("./GlobalEvents");
const File_1 = require("./File");
const fs = require("fs");
const Time_1 = require("./Time");
const file = new File_1.File(process.argv[1]);
if (process.cwd() !== file.fPath) {
    //process.chdir(file.dir);
}
if (process.argv.length > 2) {
    const fStream = fs.createWriteStream(process.argv[2], { autoClose: true, encoding: 'utf8' });
    fStream.write('[Log Time] : ' + Time_1.Time.GetInstance().GetTimeStamp() + '\r\n');
    GlobalEvents_1.GlobalEvent.on('log', data => {
        fStream.write(data.line + '\r\n');
    });
    process.on('exit', () => {
        fStream.end('\r\n\r\n');
    });
}
const server = net.createServer((socket) => {
    Handler.HandlePort_1122(socket);
});
server.on('error', (err) => {
    GlobalEvents_1.GlobalEvent.emit('msg', {
        type: 'Error',
        contentType: 'object',
        content: JSON.stringify(err)
    });
    GlobalEvents_1.GlobalEvent.emit('log', { line: JSON.stringify(err), type: 'Error' });
});
server.on('close', () => {
    GlobalEvents_1.GlobalEvent.emit('log', { line: 'GDBServer closed!' });
    GlobalEvents_1.GlobalEvent.emit('Server_Close');
});
server.listen(1122, 'localhost', () => {
    GlobalEvents_1.GlobalEvent.emit('log', { line: '[GDBServer] : start!' });
    GlobalEvents_1.GlobalEvent.emit('Server_Launched');
});
GlobalEvents_1.GlobalEvent.on('Request_Close', () => {
    server.close();
});
GlobalEvents_1.GlobalEvent.on('log', data => {
    switch (data.type) {
        case 'Error':
            console.error(data.line);
            break;
        case 'Warning':
            console.warn(data.line);
            break;
        default:
            console.log(data.line);
            break;
    }
});
//# sourceMappingURL=server.js.map