// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { WorkspaceFolder, DebugConfiguration, CancellationToken, ProviderResult } from 'vscode';
import * as net from 'net';
import { STM32DebugAdapter } from './DebugAdapter';
import { ConfigHover } from './Hover';
import { ResManager } from './ResManager';
import { GlobalEvent } from './GlobalEvents';
import { LaunchConfigExplorer } from './LaunchConfigView';
import { LogManager } from './LogManager';
import { LogAnalyzer } from './LogAnalyzer';
import { WARNING, ERROR, INFORMATION } from './StringTable';


// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated

	if (ResManager.GetInstance(context).GetWorkspace()) {

		LogManager.GetInstance();

		console.log('"STM32-Debugger" is now active!');

		context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('STM32', new STM32ConfigurationProvider()));

		context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('STM32', new STM32DebugAdapterDescriptorFactory()));

		context.subscriptions.push(vscode.languages.registerHoverProvider(ConfigHover.CreateDocFilter(), new ConfigHover()));

		let configExplorer: LaunchConfigExplorer = new LaunchConfigExplorer();

		context.subscriptions.push(vscode.commands.registerCommand('Config.change.property', (item) => configExplorer.ModifyLaunchConfig(item)));

		context.subscriptions.push(vscode.commands.registerCommand('Config.delete.property', (item) => configExplorer.DeleteConfig(item)));

		context.subscriptions.push(vscode.commands.registerCommand('Config.add.property', () => configExplorer.AddNewConfig()));

		GlobalEvent.emit('Extension_Launch_Done');

		console.log('"STM32-Debugger" launch ok!');

		LogAnalyzer.on('Warning', (msg) => {
			vscode.window.showWarningMessage((msg.title ? msg.title : WARNING) + ' : ' + msg.text);
		});

		LogAnalyzer.on('Error', (msg) => {
			vscode.window.showErrorMessage((msg.title ? msg.title : ERROR) + ' : ' + msg.text);
		});

		LogAnalyzer.on('Info', (msg) => {
			vscode.window.showInformationMessage((msg.title ? msg.title : INFORMATION) + ' : ' + msg.text);
		});

	}
}

// this method is called when your extension is deactivated
export function deactivate() {
	GlobalEvent.emit('Extension_Close');
}

class STM32ConfigurationProvider implements vscode.DebugConfigurationProvider {

	/**
	 * Massage a debug configuration just before a debug session is being launched,
	 * e.g. add all missing attributes to the debug configuration.
	 */
	resolveDebugConfiguration(folder: WorkspaceFolder | undefined, config: DebugConfiguration, token?: CancellationToken): ProviderResult<DebugConfiguration> {

		// if launch.json is missing or empty
		if (!folder) {
			return vscode.window.showWarningMessage("Workspace not found").then(_ => {
				return undefined;	// abort launch
			});
		}

		return config;
	}
}

class STM32DebugAdapterDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {

	private server?: net.Server;

	createDebugAdapterDescriptor(session: vscode.DebugSession, executable: vscode.DebugAdapterExecutable | undefined): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {

		if (!this.server) {
			this.server = net.createServer(socket => {
				const session = new STM32DebugAdapter();
				session.setRunAsServer(true);
				session.start(<NodeJS.ReadableStream>socket, socket);
			}).listen(2233);
		}

		// make VS Code connect to debug server
		return new vscode.DebugAdapterServer((<net.AddressInfo>this.server.address()).port);
	}

	dispose() {
		if (this.server) {
			this.server.close();
		}
	}
}