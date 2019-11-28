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
import * as zlib from 'zlib';
import * as crypto from 'crypto';
import { RemoteRequest, RemoteResponse } from "./RemoteServerProtocol";

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

    private md5(data: string): string {
        const md5 = crypto.createHash('md5');
        return md5.update(data).digest('hex');
    }

    createUploadData(data: string): Promise<RemoteRequest> {

        return new Promise((resolve) => {

            const res: RemoteRequest = {
                appName: 'stm32-debugger',
                version: ResManager.GetInstance().GetAppVersion(),
                tag: 'log',
                uuid: GetUUID(),
                md5: '',
                data: ''
            };

            try {
                zlib.gzip(data, (err, result) => {
                    if (!err) {
                        res.data = result.toString();
                        res.md5 = this.md5(res.data);
                        resolve(res);
                    } else {
                        resolve(res);
                    }
                });
            } catch (error) {
                resolve(res);
            }
        });
    }

    upload() {

        const logList = ResManager.GetInstance().GetLogDir().GetList([/\.log$/i]);

        const netReq = new NetRequest();
        const hostInfo = ResManager.GetInstance().GetHostInfo();

        logList.forEach(async (log) => {

            const res = await netReq.Request<RemoteRequest, RemoteResponse>({
                host: hostInfo.host,
                port: hostInfo.port,
                content: await this.createUploadData(log.Read()),
                timeout: 3000
            });

            if (res && res.success && res.content && res.content.success) {
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