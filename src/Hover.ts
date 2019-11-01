import * as vscode from 'vscode';
import { transfer_speed, is_init_registers, elf_path_hit, debug_protocol_name, endian_mode, mcu_model, config_name } from './StringTable';

export class ConfigHover implements vscode.HoverProvider {

    static hoverMap: any = {
        'name': new vscode.Hover(config_name),
        'device': new vscode.Hover(mcu_model),
        'endian': new vscode.Hover(endian_mode),
        'protocolType': new vscode.Hover(debug_protocol_name),
        'transmissionSpeed': new vscode.Hover(transfer_speed),
        'initRegister': new vscode.Hover(is_init_registers),
        'elfPath': new vscode.Hover(elf_path_hit),
    };

    provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.ProviderResult<vscode.Hover> {
        let range: vscode.Range | undefined;
        let hover: vscode.Hover;

        for (let key in ConfigHover.hoverMap) {
            range = document.getWordRangeAtPosition(position, new RegExp('"' + key + '"'));
            if (range) {
                hover = ConfigHover.hoverMap[key];
                hover.range = range;
                return hover;
            }
        }
    }

    static GetHoverString(propertyName: string): string {
        let mStr = ConfigHover.hoverMap[propertyName].contents[0];
        return typeof mStr === 'string' ? mStr : mStr.value;
    }

    static CreateDocFilter(): vscode.DocumentFilter {
        return {
            language: 'json',
            pattern: '**/.EIDE/launchConfig.json',
            scheme: 'file'
        };
    }

}