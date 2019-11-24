import { LogAnalyzer } from "./LogAnalyzer";
import { File } from "../lib/node-utility/File";
import { ResManager } from "./ResManager";
import { Message } from "./Message";
import * as fs from 'fs';
import { EOL } from "os";
import { GetUUID } from "./Device";
import { Time } from "../lib/node-utility/Time";
import { GlobalEvent } from "./GlobalEvents";
import { NetRequest } from "../lib/node-utility/NetRequest";

let _instance: LogDumper | undefined;

export class LogDumper {

    static readonly TAG = 'stm32-debugger';

    private logFile: File;

    private constructor() {
        this.logFile = new File(ResManager.GetInstance().GetLogDir().path + File.sep + LogDumper.TAG + '.log');
        this.InitDumper();
    }

    static getInstance(): LogDumper {
        if (_instance === undefined) {
            _instance = new LogDumper();
        }
        return _instance;
    }

    private InitDumper() {

        const dir = ResManager.GetInstance().GetLogDir();

        if (!dir.IsDir()) {
            dir.CreateDir(true);
        }

        const data = '[' + LogDumper.TAG + '] : [' + GetUUID() + '] : log at : ' + Time.GetInstance().GetTimeStamp();

        this.write(data);
    }

    private Msg2String(log: Message): string {
        return '[' + log.type + '] : ' + (log.contentType === 'string' ? log.content : JSON.stringify(log.content));
    }

    private write(data: string) {
        fs.appendFile(this.logFile.path, data + EOL, (err) => {
            if (err) {
                console.warn('[LogDumper] : write error ! ' + err);
            }
        });
    }

    dump(data: Message) {
        this.write(this.Msg2String(data));
    }

    close() {
        this.write(EOL);
    }

    clear() {
        if (this.logFile.IsFile()) {
            fs.unlink(this.logFile.path, (err) => {
                if (err) {
                    this.logFile.Write('');
                }
            });
        }
    }

    upload() {

        const logList = ResManager.GetInstance().GetLogDir().GetList([/\.log$/i]);

        const netReq = new NetRequest();
        const hostInfo = ResManager.GetInstance().GetHostInfo();

        logList.forEach(async (log) => {

            const res = await netReq.Request<string>({
                host: hostInfo.host,
                port: hostInfo.port,
                content: log.Read()
            });

            if (res && res.success) {
                GlobalEvent.emit('msg', {
                    type: 'Info',
                    contentType: 'string',
                    content: 'Upload Log \'' + log.name + '\' success ! ' + res ? (res.msg ? res.msg : '') : ''
                });
            } else {
                GlobalEvent.emit('msg', {
                    type: 'Warning',
                    contentType: 'string',
                    content: 'Upload Log \'' + log.name + '\' error ! ' + (res ? (res.msg ? res.msg : '') : '')
                });
            }
        });
    }
}

LogAnalyzer.on('Log', (logData) => {
    LogDumper.getInstance().dump(logData);
});

GlobalEvent.on('Extension_Close', () => {
    LogDumper.getInstance().close();
});