import * as http from 'http';
import * as events from 'events';
import { TCPData } from './GDBProtocol';

export interface RequestOption {
    host: string;
    port: number;
    timeOut?: number;
    content: TCPData;
}

export interface NetResponse {
    success: boolean;
    statusCode?: number;
    content?: TCPData;
}

export class NetRequest {

    private _event: events.EventEmitter;

    constructor() {
        this._event = new events.EventEmitter();
    }

    on(event: 'error', listener: (err: Error) => void): this;
    on(event: any, listener: (argc?: any) => void): this {
        this._event.on(event, listener);
        return this;
    }

    Request(option: RequestOption): Promise<NetResponse> {

        return new Promise((resolve) => {

            let resolved = false;

            let request = http.request({
                protocol: 'http:',
                host: option.host,
                port: option.port,
                method: 'POST',
                timeout: option.timeOut
            }, (res) => {

                let data: string = '';

                res.setEncoding('utf8');
                res.on('data', (buf) => {
                    data += buf;
                });

                res.on('error', (err) => {
                    this._event.emit('error', err);
                });

                res.on('close', () => {

                    if (!resolved) {

                        resolved = true;

                        if (res.statusCode && res.statusCode < 400) {

                            let content: TCPData | undefined;

                            try {
                                content = JSON.parse(data);
                            } catch (err) {
                                this._event.emit('error', new Error(http.STATUS_CODES[res.statusCode ? res.statusCode : 403]));
                            }

                            resolve({
                                success: true,
                                statusCode: res.statusCode,
                                content: content
                            });
                        } else {
                            resolve({
                                success: false,
                                statusCode: res.statusCode
                            });
                        }
                    }
                });
            });

            request.on('error', (err) => {

                if (!resolved) {

                    resolved = true;

                    resolve({
                        success: false
                    });
                }

                this._event.emit('error', err);
            });

            request.end(JSON.stringify(option.content));
        });
    }
}