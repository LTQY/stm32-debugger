import * as vscode from 'vscode';
import { LaunchConfigManager } from './LaunchConfig';

export class ConfigCompletion implements vscode.CompletionItemProvider {

    provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {

        let line = document.lineAt(position);

        let lineText = line.text.substring(0, position.character);

        return <Thenable<vscode.CompletionItem[] | vscode.CompletionList>>{

            then<TResult>(onfulfilled?: (value: vscode.CompletionItem[] | vscode.CompletionList) => TResult | Thenable<TResult>, onrejected?: (reason: any) => TResult | Thenable<TResult>) {
                let completionList: vscode.CompletionList;

                completionList = new vscode.CompletionList([], false);

                if (/\s*"endian"\s*:\s*"[^",]*$/.test(lineText)) {
                    if (onfulfilled) {
                        onfulfilled(LaunchConfigManager.GetInstance().endianList);
                    }
                }
                if (/\s*"protocolType"\s*:\s*"[^",]*$/.test(lineText)) {
                    if (onfulfilled) {
                        onfulfilled(LaunchConfigManager.GetInstance().protocolList);
                    }
                }

                if (/\s*"device"\s*:\s*"[^",]*$/.test(lineText)) {

                    let regList = /\s*"device"\s*:\s*"([^",]*)$/.exec(lineText);

                    if (regList && regList.length > 1) {
                        completionList.items = ConfigCompletion.GetMatchedList(regList[1]);
                    }
                    if (onfulfilled) {
                        onfulfilled(completionList);
                    }
                }
            }
        };
    }

    resolveCompletionItem?(item: vscode.CompletionItem, token: vscode.CancellationToken): vscode.ProviderResult<vscode.CompletionItem> {
        return null;
    }

    static GetMatchedList(word: string, limit?: number): vscode.CompletionItem[] {
        let cList: vscode.CompletionItem[] = [];
        let limitNum: Number = limit ? limit : 50;

        let list = LaunchConfigManager.GetInstance().deviceList;
        for (let i = 0, j = 0; i < list.length; i++) {
            if ((new RegExp('^' + word + '\\w*')).test(list[i].label)) {
                cList.push(list[i]);
                if (++j >= limitNum) {
                    break;
                }
            }
        }

        return cList;
    }

    static CreateDocFilter(): vscode.DocumentFilter {
        return {
            language: 'json',
            pattern: '**/.EIDE/launchConfig.json',
            scheme: 'file'
        };
    }
}