import { File } from "../lib/node-utility/File";
import * as events from 'events';
import * as vscode from 'vscode';
import * as Path from 'path';

export let launchConfigName = 'launchConfig.json';
export let deviceFileName = 'JLinkDevices.xml';

let resManager: ResManager | undefined;

let prjEnvList: string[] = [
    Path.sep + '.vscode',
    Path.sep + '.vscode' + Path.sep + 'log'
];

let sysEnvList: string[] = [
    Path.sep + 'bin' + Path.sep + 'GDBWrapper',
    //Path.sep + '..' + Path.sep + 'GDBWrapper',
    Path.sep + 'bin' + Path.sep + 'JLinkServer',
    Path.sep + 'res' + Path.sep + 'icons',
    Path.sep + 'res' + Path.sep + 'data'
];

let hostFileName = 'hostInfo.json';

export interface HostInfo {
    host: string;
    port: number;
}

export class ResManager extends events.EventEmitter {

    //data
    private workspace: File | undefined;
    private dirMap: Map<string, File>;
    private iconMap: Map<string, File>;
    private context: vscode.ExtensionContext | undefined;

    private serverInfo: any;

    private constructor(context?: vscode.ExtensionContext) {
        super();
        this.dirMap = new Map();
        this.iconMap = new Map();

        if (context) {
            this.context = context;
        } else {
            throw Error('context is undefined');
        }

        let w = vscode.workspace.workspaceFolders;
        if (w && w.length > 0) {
            this.Load(w);
            this.CheckAllDirs();
            this.InitIcons();
            this.InitHostInfo();
        } else {
            this.workspace = undefined;
        }
    }

    static GetInstance(context?: vscode.ExtensionContext): ResManager {
        if (resManager) {
            return resManager;
        }
        resManager = new ResManager(context);
        return resManager;
    }

    private InitIcons() {
        let dir = this.dirMap.get('icons');
        if (dir) {
            dir.GetList().forEach((f) => {
                this.iconMap.set(f.noSuffixName, f);
            });
        } else {
            throw new Error('Not found icons dir');
        }
    }

    private InitHostInfo() {
        let dir = this.dirMap.get('data');
        if (dir) {
            let fList = dir.GetList([new RegExp('^' + hostFileName + '$', 'i')], File.EMPTY_FILTER);
            if (fList.length > 0) {
                this.serverInfo = JSON.parse(fList[0].Read());
            } else {
                throw new Error('Not found \'' + hostFileName + '\' configuration file');
            }
        } else {
            throw new Error('Not found data dir');
        }
    }

    GetHostInfo(): HostInfo {
        return {
            host: this.serverInfo.host,
            port: this.serverInfo.port
        };
    }


    GetIconByName(name: string): File | undefined {
        return this.iconMap.get(name);
    }

    GetWorkspace(): File | undefined {
        return this.workspace;
    }

    GetProjectConfigDir(): File {
        return this.GetDir('.vscode');
    }

    GetLogDir(): File {
        return this.GetDir('log');
    }

    GetLaunchConfigFile(): File {
        return new File(this.GetProjectConfigDir().path + Path.sep + launchConfigName);
    }

    GetGDBWrapperDir(): File {
        return this.GetDir('GDBWrapper');
    }

    GetJLinkDir(): File {
        return this.GetDir('JLinkServer');
    }

    private GetDir(name: string): File {
        let f = this.dirMap.get(name);
        if (f) {
            return f;
        }
        throw <Error>{
            name: ResManager.name,
            message: 'Not Found Key \'' + name + '\''
        };
    }

    private Load(w: vscode.WorkspaceFolder[]) {
        this.workspace = new File(w[0].uri.fsPath);

        let f: File;
        let wsPath = this.workspace.path;

        prjEnvList.forEach((dir) => {
            f = new File(wsPath + dir);
            this.dirMap.set(f.name, f);
        });

        sysEnvList.forEach((dir) => {
            if (this.context) {
                f = new File(this.context.extensionPath + dir);
                this.dirMap.set(f.name, f);
            } else {
                throw new Error('Extension Context is undefined');
            }
        });
    }

    private CheckAllDirs() {

        let f: File = this.GetProjectConfigDir();
        if (!f.IsExist()) {
            f.CreateDir(true);
        }

        f = this.GetLogDir();
        if (!f.IsExist()) {
            f.CreateDir(true);
        }

        let launchFile = this.GetLaunchConfigFile();
        if (!launchFile.IsExist()) {
            launchFile.Write('[]');
        }

        this.dirMap.forEach((file) => {
            if (!file.IsExist()) {
                throw <Error>{
                    name: ResManager.name,
                    message: 'Not Found Dir: \'' + file.path + '\''
                };
            }
        });
    }
} 