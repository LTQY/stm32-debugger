import * as vscode from "vscode";
import { JLinkConfig, LaunchConfigManager } from "./LaunchConfig";
import { Handles } from "vscode-debugadapter";
import { GlobalEvent } from "./GlobalEvents";
import { ResManager } from "./ResManager";
import { File } from "../lib/node-utility/File";
import { ConfigHover } from "./Hover";
import { input_config_name, name_clash, transfer_speed, transfer_speed_hit } from "./StringTable";

type ItemType = 'Config' | 'Property';

export class ConfigItem extends vscode.TreeItem {
    readonly nodeType: ItemType;
    readonly config: JLinkConfig;
    readonly name: string;

    parentReferance?: number;
    childReferances: number[];

    constructor(name: string, val: string, nodeType: ItemType, config: JLinkConfig) {
        super(name + ' : ' + val);
        this.name = name;
        this.nodeType = nodeType;
        this.contextValue = nodeType;
        this.config = config;
        this.childReferances = [];

        this.collapsibleState = vscode.TreeItemCollapsibleState.None;

        if (name === 'name' && !config) {
            throw new Error('Undefined param \'config\'');
        }

        let iconName = name === 'name' ? 'ConfigurationFile_16x' : 'Property_16x';
        let iconFile: File | undefined = ResManager.GetInstance().GetIconByName(iconName);

        if (iconFile) {
            this.iconPath = {
                light: vscode.Uri.parse(iconFile.ToUri()),
                dark: vscode.Uri.parse(iconFile.ToUri())
            };
        } else {
            throw Error('Not found icon file \'' + iconName + '\'');
        }

        if (name === 'name') {
            this.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
        }

        this.tooltip = ConfigHover.GetHoverString(name);
    }
}

class LaunchConfigDataProvider implements vscode.TreeDataProvider<ConfigItem> {

    private _triggerEvent: vscode.EventEmitter<any>;
    onDidChangeTreeData: any;

    private configManager: LaunchConfigManager;

    private itemList: ConfigItem[];
    private handleMap: Handles<ConfigItem>;

    constructor() {
        this.itemList = [];
        this.handleMap = new Handles(10);
        this._triggerEvent = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._triggerEvent.event;
        this.configManager = LaunchConfigManager.GetInstance();
        this.configManager.on('ConfigChanged', () => {
            this.ClearConfig();
            this.Update();
        });
        this.Update();
    }

    private Update() {
        this.configManager.GetConfigList().forEach((config) => {
            this.AddConfig(config);
        });
        this._triggerEvent.fire();
    }

    private ClearConfig() {
        this.itemList = [];
        this.handleMap.reset();
    }

    private AddConfig(config: JLinkConfig) {

        let item: ConfigItem = new ConfigItem('name', config.name, 'Config', config);
        let ref = this.handleMap.create(item);
        this.itemList.push(item);

        let property: ConfigItem;
        let val: any;
        for (let key in config) {
            if (key !== 'name') {
                val = (<any>config)[key];
                property = new ConfigItem(key, typeof val === 'string' ? val : JSON.stringify(val), 'Property', config);
                property.parentReferance = ref;
                item.childReferances.push(this.handleMap.create(property));
            }
        }
    }

    GetConfig(configName: string): JLinkConfig | undefined {
        return this.configManager.GetConfigByName(configName);
    }

    ModifyConfig<T>(config: JLinkConfig, name: string, val: T) {

        let errMsg: string | undefined;
        let conifg: JLinkConfig = config;

        if (conifg) {

            switch (name) {
                case 'name':
                    if (typeof val === 'string') {
                        conifg.name = val;
                    } else {
                        errMsg = 'Error property type on : \'' + name + '\'';
                    }
                    break;
                case 'device':
                    if (typeof val === 'string') {
                        conifg.device = val;
                    } else {
                        errMsg = 'Error property type on : \'' + name + '\'';
                    }
                    break;
                case 'endian':
                    if (typeof val === 'string') {
                        conifg.endian = val;
                    } else {
                        errMsg = 'Error property type on : \'' + name + '\'';
                    }
                    break;
                case 'protocolType':
                    if (typeof val === 'string') {
                        conifg.protocolType = val;
                    } else {
                        errMsg = 'Error property type on : \'' + name + '\'';
                    }
                    break;
                case 'transmissionSpeed':
                    if (typeof val === 'number') {
                        conifg.transmissionSpeed = val;
                    } else {
                        errMsg = 'Error property type on : \'' + name + '\'';
                    }
                    break;
                case 'initRegister':
                    if (typeof val === 'boolean') {
                        conifg.initRegister = val;
                    } else {
                        errMsg = 'Error property type on : \'' + name + '\'';
                    }
                    break;
                default:
                    errMsg = 'Unknown property name: \'' + name + '\'';
                    break;
            }
        } else {
            errMsg = 'Unknown config name: \'' + config + '\'';
        }

        if (errMsg) {
            GlobalEvent.emit('msg', {
                type: 'Warning',
                contentType: 'string',
                className: LaunchConfigDataProvider.name,
                methodName: this.ModifyConfig.name,
                content: errMsg
            });
        } else {
            this.configManager.Update();
        }
    }

    getTreeItem(element: ConfigItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element;
    }

    getChildren(element?: ConfigItem | undefined): vscode.ProviderResult<ConfigItem[]> {
        if (element) {
            let iList: ConfigItem[] = [];
            element.childReferances.forEach((referance) => {
                iList.push(this.handleMap.get(referance));
            });
            return iList;
        } else {
            return this.itemList;
        }
    }

}

export class LaunchConfigExplorer {

    private view: vscode.TreeView<ConfigItem>;
    private dataProvider: LaunchConfigDataProvider;

    constructor() {
        this.dataProvider = new LaunchConfigDataProvider();
        this.view = vscode.window.createTreeView('STM32-launch-config-manager', <vscode.TreeViewOptions<ConfigItem>>{
            treeDataProvider: this.dataProvider
        });
    }

    private ChangeConfigName(item: ConfigItem) {
        vscode.window.showInputBox({
            prompt: input_config_name,
            validateInput: (str): string | Thenable<string | null | undefined> | null | undefined => {
                return this.dataProvider.GetConfig(str) ? name_clash : undefined;
            }
        }).then((nName) => {
            if (nName) {
                if (item.config) {
                    this.dataProvider.ModifyConfig<string>(item.config, 'name', nName);
                } else {
                    throw new Error('Undefined config in ConfigItem');
                }
            }
        });
    }

    private ChangeDeviceProperty(item: ConfigItem) {
        vscode.window.showQuickPick(LaunchConfigManager.GetInstance().deviceList, {
            canPickMany: false
        }).then((dName) => {
            if (dName) {
                if (item.config) {
                    this.dataProvider.ModifyConfig<string>(item.config, 'device', dName.label);
                } else {
                    throw new Error('Undefined config in ConfigItem');
                }
            }
        });
    }

    private ChangeEndianProperty(item: ConfigItem) {
        vscode.window.showQuickPick(LaunchConfigManager.GetInstance().endianList, {
            canPickMany: false
        }).then((dName) => {
            if (dName) {
                if (item.config) {
                    this.dataProvider.ModifyConfig<string>(item.config, 'endian', dName.label);
                } else {
                    throw new Error('Undefined config in ConfigItem');
                }
            }
        });
    }

    private ChangeProtocolTypeProperty(item: ConfigItem) {
        vscode.window.showQuickPick(LaunchConfigManager.GetInstance().protocolList, {
            canPickMany: false
        }).then((dName) => {
            if (dName) {
                if (item.config) {
                    this.dataProvider.ModifyConfig<string>(item.config, 'protocolType', dName.label);
                } else {
                    throw new Error('Undefined config in ConfigItem');
                }
            }
        });
    }

    private ChangeTransmissionSpeedProperty(item: ConfigItem) {
        vscode.window.showInputBox({
            prompt: transfer_speed,
            validateInput: (str): string | Thenable<string | null | undefined> | null | undefined => {
                if (/^[0-9]{3,}$/.test(str)) {
                    const speed = parseInt(str);
                    if (speed <= 10000 && speed > 100) {
                        return undefined;
                    }
                }
                return transfer_speed_hit;
            }
        }).then((speed) => {
            if (speed) {
                if (item.config) {
                    this.dataProvider.ModifyConfig<number>(item.config, 'transmissionSpeed', Number.parseInt(speed));
                } else {
                    throw new Error('Undefined config in ConfigItem');
                }
            }
        });
    }

    private ChangeInitRegisterProperty(item: ConfigItem) {
        vscode.window.showQuickPick(['true', 'false'], {
            canPickMany: false
        }).then((res) => {
            if (res) {
                if (item.config) {
                    this.dataProvider.ModifyConfig<boolean>(item.config, 'initRegister', res === 'true');
                } else {
                    throw new Error('Undefined config in ConfigItem');
                }
            }
        });
    }

    ModifyLaunchConfig(item: ConfigItem) {

        if (!item) {
            throw new Error('ModifyLaunchConfig Error: undefined \'configItem\'');
        }

        switch (item.name) {
            case 'name':
                this.ChangeConfigName(item);
                break;
            case 'device':
                this.ChangeDeviceProperty(item);
                break;
            case 'endian':
                this.ChangeEndianProperty(item);
                break;
            case 'initRegister':
                this.ChangeInitRegisterProperty(item);
                break;
            case 'protocolType':
                this.ChangeProtocolTypeProperty(item);
                break;
            case 'transmissionSpeed':
                this.ChangeTransmissionSpeedProperty(item);
                break;
            default:
                GlobalEvent.emit('msg', {
                    type: 'Warning',
                    contentType: 'string',
                    className: LaunchConfigExplorer.name,
                    methodName: this.ModifyLaunchConfig.name,
                    content: 'Unknown item property: \'' + item.label + '\''
                });
                break;
        }
    }

    AddNewConfig() {
        LaunchConfigManager.GetInstance().AddNewConfig();
    }

    DeleteConfig(item: ConfigItem) {
        LaunchConfigManager.GetInstance().DeleteConfig(item.config);
    }
}