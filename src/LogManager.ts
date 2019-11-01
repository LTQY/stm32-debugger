import { File } from './File';
import { Message, ExceptionToMessage } from './Message';
import { ResManager, HostInfo } from './ResManager';
import * as Path from 'path';
import { GlobalEvent } from './GlobalEvents';
import { EventEmitter } from 'events';
import { Time } from './Time';
import { NetRequest } from './NetRequest';
import { LogAnalyzer } from './LogAnalyzer';
import { GetUUID } from './Device';
import { RemoteRequest, LogData } from './RemoteServerProtocol';

let _logger: LogManager;
let uuid = GetUUID();

export class LogManager extends EventEmitter {

    static logName = 'log.json';

    private static uploadLimit = 5;
    private static errorLimit = 3;

    private errCount: number;

    private logData: LogData;
    private logFile: File;
    private currentCount: number;

    private hostInfo: HostInfo;

    private constructor() {
        super();
        this.logFile = new File(ResManager.GetInstance().GetLogDir().path + Path.sep + LogManager.logName);
        this.logData = {};
        this.currentCount = 0;
        this.errCount = 0;
        this.hostInfo = ResManager.GetInstance().GetHostInfo();
        this.RegisterEvents();
    }

    GetLogData(): LogData {
        return this.logData;
    }

    GetLogFile(): File {
        return this.logFile;
    }

    ClearAll() {
        this.logData = {};
        this.Dump();
    }

    private IsEmpty(): boolean {
        return !(this.logData.error || this.logData.info || this.logData.other || this.logData.warning);
    }

    Log(log: Message) {
        switch (log.type) {
            case 'Warning':
                this.logData.warning ?
                    this.logData.warning.push(log) :
                    this.logData.warning = [log];
                break;
            case 'Error':
                this.logData.error ?
                    this.logData.error.push(log) :
                    this.logData.error = [log];
                break;
            case 'Info':
                this.logData.info ?
                    this.logData.info.push(log) :
                    this.logData.info = [log];
                break;
            default:
                this.logData.other ?
                    this.logData.other.push(log) :
                    this.logData.other = [log];
                break;
        }
        this.UpdateLogNumber();
    }

    Dump() {
        this.logFile.Write(JSON.stringify(this.logData));
        this.ResetCount();
    }

    private ErrorDump() {
        this.Dump();
        this.errCount++;
    }

    private ResetCount() {
        this.currentCount = 0;
    }

    private UpdateLogNumber() {
        this.currentCount++;
        this.NotifyEvents(this.currentCount);
    }

    private NotifyEvents(logNum: number) {
        if (logNum >= LogManager.uploadLimit) {
            if (this.errCount < LogManager.errorLimit) {
                this.emit('trigger_upload');
            } else {
                this.emit('trigger_dump');
            }
        }
    }

    private RegisterEvents() {
        super.on('trigger_upload', () => {
            this.Upload();
        });
        super.on('trigger_dump', () => {
            this.Dump();
        });
    }

    Load() {
        if (this.logFile.IsExist()) {
            try {
                this.logData = JSON.parse(this.logFile.Read());
            } catch (err) {
                this.logData = {};
                GlobalEvent.emit('error', err);
            }
            this.ResetCount();
        }
    }

    private async UploadLog(): Promise<void> {

        let uploadData: RemoteRequest = {
            appName: 'CL.stm32-debugger',
            timeStamp: Time.GetInstance().GetTimeStamp(),
            uid: uuid,
            data: JSON.stringify(this.logData)
        };

        const req = new NetRequest();

        req.on('error', (err) => {
            const msg: Message = ExceptionToMessage(err);
            msg.type = 'Warning';
            GlobalEvent.emit('msg', msg);
        });

        const response = await req.Request({
            host: this.hostInfo.host,
            port: this.hostInfo.port,
            content: {
                tag: 'Log',
                data: JSON.stringify(uploadData)
            }
        });

        return new Promise((resolve, reject) => {
            if (response.success) {
                resolve();
            } else {
                reject();
            }
        });
    }

    Upload() {
        if (!this.IsEmpty()) {
            this.UploadLog().then(() => {
                this.ClearAll();
            }, () => {
                this.ErrorDump();
            });
        }
    }

    static GetInstance(): LogManager {
        if (!_logger) {
            _logger = new LogManager();
        }
        return _logger;
    }
}

LogAnalyzer.on('Log', (msg) => {
    msg.timeStamp = Time.GetInstance().GetTimeStamp();
    LogManager.GetInstance().Log(msg);
});

GlobalEvent.on('Extension_Launch_Done', () => {

    LogManager.GetInstance().Load();

    LogManager.GetInstance().Upload();
});

GlobalEvent.on('Extension_Close', () => {
    LogManager.GetInstance().Dump();
});