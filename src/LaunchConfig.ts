import * as vscode from 'vscode';
import * as x2js from 'x2js';
import { File } from './File';
import { ResManager, deviceFileName } from './ResManager';
import * as Path from 'path';
import * as fs from 'fs';
import { EventEmitter } from 'events';
import { create_new_config, has_no_config, select_a_config, config_name_not_be_empty, unsupported_chip_type, unsupported_storage_mode, unsupported_debug_protocol, unsupported_transmission_speed, transfer_speed_hit, invalid_elf_file_path } from './StringTable';

export interface JLinkConfig {
    name: string;
    device: string;
    endian: string;
    protocolType: string;
    transmissionSpeed: number;
    initRegister: boolean;
}

export interface CheckResult {
    state: 'pass' | 'failed';
    tag?: string;
    message?: string;
}

let launchConfigManager: LaunchConfigManager;

export class LaunchConfigManager extends EventEmitter {

    private configFile: File;
    private launchList: JLinkConfig[];

    readonly protocolList: vscode.CompletionItem[] = [
        { label: 'SWD', kind: vscode.CompletionItemKind.Field },
        { label: 'JTAG', kind: vscode.CompletionItemKind.Field },
        { label: 'cJTAG', kind: vscode.CompletionItemKind.Field },
        { label: 'FINE', kind: vscode.CompletionItemKind.Field },
        { label: 'ICSP', kind: vscode.CompletionItemKind.Field }
    ];
    readonly endianList: vscode.CompletionItem[] = [
        { label: 'little', kind: vscode.CompletionItemKind.Field },
        { label: 'big', kind: vscode.CompletionItemKind.Field }
    ];
    readonly deviceList: vscode.CompletionItem[] = [];

    on(event: 'ConfigChanged', listener: (list: JLinkConfig[]) => void): this;
    on(event: any, listener: (args?: any) => void): this {
        return super.on(event, listener);
    }

    emit(event: 'ConfigChanged', list: JLinkConfig[]): boolean;
    emit(event: any, args?: any): boolean {
        return super.emit(event, args);
    }

    private constructor() {

        super();

        this.configFile = ResManager.GetInstance().GetLaunchConfigFile();
        this.launchList = [];

        if (!this.configFile.IsExist()) {
            this.AddNewConfig('New');
        } else {
            this.Load();
        }

        this.RegisterWatcher();

        let file = new File(ResManager.GetInstance().GetJLinkDir().path + Path.sep + deviceFileName);
        if (!file.IsExist() || !file.IsFile()) {
            throw <Error>{
                name: LaunchConfigManager.name,
                message: 'Not Found JLinkDevices.xml File'
            };
        }
        let parser = new x2js({
            arrayAccessFormPaths: ['DeviceDatabase.VendorInfo.DeviceInfo'],
            attributePrefix: '$'
        });
        let js = parser.xml2js<any>(file.Read());

        let vendorInfo: any = js.DeviceDatabase.VendorInfo;
        let dList: any;

        while (vendorInfo) {

            if (!vendorInfo.$Name) {
                throw new Error('Parser Error on \'VendorInfo.Name\' at JLinkDevices.xml File');
            }
            if (vendorInfo.$Name !== 'Unspecified') {
                dList = vendorInfo.DeviceInfo;
                if (!dList) {
                    throw new Error('Parser Error on \'DeviceInfo\' at JLinkDevices.xml File');
                }
                if (dList[0]) {
                    (<any[]>dList).forEach((device) => {
                        if (!device.$Name) {
                            throw new Error('Parser Error on \'DeviceInfo.Name\' at JLinkDevices.xml File');
                        } else {
                            this.deviceList.push({
                                label: device.$Name,
                                kind: vscode.CompletionItemKind.Field
                            });
                        }
                    });
                } else {
                    this.deviceList.push({
                        label: dList.$Name,
                        kind: vscode.CompletionItemKind.Field
                    });
                }
            }

            vendorInfo = vendorInfo.VendorInfo;
        }
    }

    static GetDefault(configName?: string): JLinkConfig {
        return {
            name: configName ? configName : 'default_' + (Math.random() * 10000).toString().split('.')[0],
            device: 'STM32F103C8',
            endian: 'little',
            protocolType: 'SWD',
            transmissionSpeed: 4000,
            initRegister: false
        };;
    }

    static GetInstance(): LaunchConfigManager {
        if (launchConfigManager) {
            return launchConfigManager;
        }
        launchConfigManager = new LaunchConfigManager();
        return launchConfigManager;
    }

    GetConfigList(): JLinkConfig[] {
        return this.launchList;
    }

    GetConfigByName(name: string): JLinkConfig | undefined {
        let index = this.launchList.findIndex((item) => { return name === item.name; });
        if (index !== -1) {
            return this.launchList[index];
        }
        return undefined;
    }

    AddNewConfig(configName?: string) {
        this.launchList.push(LaunchConfigManager.GetDefault(configName));
        this.Update();
    }

    DeleteConfig(config: JLinkConfig) {
        let index = this.launchList.findIndex((item) => { return config.name === item.name; });
        if (index !== -1) {
            this.launchList.splice(index, 1);
            this.Update();
        }
    }

    CheckConfig(config: JLinkConfig): CheckResult {

        if (config.name === '') {
            return {
                state: 'failed',
                tag: 'name',
                message: config_name_not_be_empty + ' !'
            };
        }

        if (this.deviceList.findIndex((device): boolean => { return device.label === config.device; }) === -1) {
            return {
                state: 'failed',
                tag: 'device',
                message: unsupported_chip_type + ' \'' + config.device + '\''
            };
        }

        if (this.endianList.findIndex((endian): boolean => { return endian.label === config.endian; }) === -1) {
            return {
                state: 'failed',
                tag: 'endian',
                message: unsupported_storage_mode + ' \'' + config.endian + '\''
            };
        }

        if (this.protocolList.findIndex((protocol): boolean => { return protocol.label === config.protocolType; }) === -1) {
            return {
                state: 'failed',
                tag: 'protocolType',
                message: unsupported_debug_protocol + ' \'' + config.protocolType + '\''
            };
        }

        if (!Number.isInteger(config.transmissionSpeed)) {
            return {
                state: 'failed',
                tag: 'transmissionSpeed',
                message: unsupported_transmission_speed
            };
        }

        if (config.transmissionSpeed < 100 || config.transmissionSpeed >= 7000) {
            return {
                state: 'failed',
                tag: 'transmissionSpeed',
                message: transfer_speed_hit
            };
        }

        return {
            state: 'pass'
        };
    }

    SelectConfig(): Promise<string> {

        return new Promise((resolve) => {
            let items: string[] = [create_new_config];

            if (this.launchList.length === 0) {
                vscode.window.showQuickPick(items, {
                    canPickMany: false,
                    placeHolder: has_no_config
                }).then(() => {
                    this.AddNewConfig();
                    resolve();
                });
            } else {
                this.launchList.forEach((conf) => {
                    items.push(conf.name);
                });
                vscode.window.showQuickPick(items, {
                    canPickMany: false,
                    placeHolder: select_a_config
                }).then((str) => {
                    if (str === items[0]) {
                        this.AddNewConfig();
                        resolve();
                    } else {
                        resolve(str);
                    }
                }, () => {
                    resolve();
                });
            }
        });
    }

    GotoLaunchConfig() {
        vscode.window.showTextDocument(vscode.Uri.parse(this.configFile.ToUri()));
    }

    Update() {
        this.Dump();
    }

    private RegisterWatcher() {
        fs.watchFile(this.configFile.path, (curr) => {
            if (curr.isFile()) {
                this.Load();
            } else {
                this.launchList = [];
                this.Update();
            }
            this.emit('ConfigChanged', this.launchList);
        });
    }

    private Load() {
        this.launchList = JSON.parse(this.configFile.Read());
    }

    private Dump() {
        this.configFile.Write(JSON.stringify(this.launchList));
    }
}