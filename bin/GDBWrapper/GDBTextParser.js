"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const GlobalEvents_1 = require("./GlobalEvents");
class GDBTextParser {
    constructor() {
        this._matcher = new ExpressionMatcher();
    }
    Parse(command, lines) {
        let response = {
            command: command,
            status: { isDone: true }
        };
        let line;
        let sList = [];
        if (command === 'print' || command === 'info locals') {
            lines = this.PreHandleStr(lines);
        }
        lines.forEach((str, index) => {
            if (index > 0) {
                line = this.HandleStr(command, str);
                /*
                 * *: "bpHit"
                 * =: "notify"
                 * ~: "console"
                 * @: "target"
                 * &: "log"
                 * ^: finish flag
                 */
                switch (line.charAt(0)) {
                    case '*':
                        response.runningStatus = this.ParseToRunningStatus(line);
                        break;
                    case '^':
                        response.status = this.ParseExecStatus(line.substr(1));
                        break;
                    case '&':
                    case '~':
                        sList.push(line.substr(1));
                        break;
                    default:
                        break;
                }
            }
        });
        this.ParseToResult(response, sList);
        return response;
    }
    ParseExecStatus(line) {
        let status = { isDone: true };
        let list = /^error,msg=(.+)/.exec(line);
        if (list) {
            status.isDone = false;
            if (list.length === 2) {
                status.msg = this.PreHandleErrorMsgLine(list[1]);
            }
            else {
                status.msg = 'TextParse Error !';
            }
        }
        return status;
    }
    PreHandleErrorMsgLine(str) {
        return str.replace(/\\[0-9]+/g, (s) => {
            const list = /\\([0-9]+)/.exec(s);
            if (list) {
                return String.fromCharCode(Number.parseInt(list[1]));
            }
            return s;
        });
    }
    PreHandleStr(lines) {
        let resList = [];
        let subList = [];
        let list;
        lines.forEach((str) => {
            list = /^~"(.+)"$/.exec(str);
            if (list) {
                if (list[1] === '\\n') {
                    resList.push('~' + subList.join(''));
                    subList = [];
                }
                else {
                    subList.push(list[1]);
                }
            }
            else {
                resList.push(str);
            }
        });
        return resList;
    }
    HandleStr(command, str) {
        const list = /^(.)"(.+)"$/.exec(str);
        if (list && list.length === 3) {
            str = list[1] + list[2];
        }
        if (command !== 'print' && command !== 'info locals') {
            str = str.replace(new RegExp(/\\t/, 'g'), ' ');
        }
        return str.replace(new RegExp(/\\n|\\r/, 'g'), '')
            .replace(new RegExp(/\\\"/, 'g'), '\"');
    }
    ParseToRunningStatus(line) {
        let list = new RegExp(/\*(\w+),(.+)/, 'g').exec(line);
        let str = '{' + list[2] + '}';
        str = str.replace(new RegExp(/-/, 'g'), '_')
            .replace(new RegExp(/\w+\s*=/, 'g'), (s) => {
            let list = /(\w+)/.exec(s);
            return '"' + list[1] + '"' + '=';
        })
            .replace(new RegExp(/=/, 'g'), ':');
        let hitInfo = {
            type: list[1],
            info: {}
        };
        hitInfo.info = JSON.parse(str);
        return hitInfo;
    }
    ParseToResult(response, lines) {
        if (response.status.isDone && !response.runningStatus) {
            switch (response.command) {
                case 'file':
                    response.status.isDone = !this._matcher.IsFileNoSymbol(lines);
                    if (!response.status.isDone) {
                        response.status.msg = 'No debugging symbols found !';
                    }
                    break;
                case 'info variables':
                    response.result = this._matcher.ParseToVariablesDefine(lines);
                    break;
                case 'info registers':
                    response.result = this._matcher.ParseToRegisterValue(lines);
                    break;
                case 'info locals':
                    response.result = this._matcher.ParseToValue(lines);
                    break;
                case 'info stack':
                    response.result = this._matcher.ParseToStacks(lines);
                    break;
                case 'print':
                    response.result = this._matcher.ParseToValue(lines);
                    break;
                case 'break':
                    response.result = this._matcher.ParseToBreakpointInfo(lines);
                    break;
                default:
                    GlobalEvents_1.GlobalEvent.emit('log', { line: '[' + GDBTextParser.name + '] : ignore command \'' + response.command + '\'' });
                    break;
            }
        }
    }
}
exports.GDBTextParser = GDBTextParser;
class ExpressionMatcher {
    constructor() {
        this._matcher = {
            //match
            //this.matchers.set('remote_Error', new RegExp(/^.*Remote communication error.+\s*/));
            //this.matchers.set('connect_Error', new RegExp(/^\.\s*/));
            //this.matchers.set('file_Not_Found', new RegExp(/^.*\s*No such file or directory.*\s*$/));
            'file_No_Symbol': new RegExp(/^.*\(No debugging symbols found.*$/),
            'is_expression': new RegExp(/^.+\s*=\s*.+$/),
            //this.matchers.set('not_found_variables', new RegExp(/^No symbol .* in current context.*$/));
            //Breakpoint 1 at 0x8002454: file d:\Code Project\ARM\IOToggle\Project\USER\main.c, line 62.
            //
            'breakpoint_Set': new RegExp(/^Breakpoint ([0-9]+) at (0x[0-9a-f]+): file (.+), line ([0-9]+).$/),
            //Breakpoint 2, main () at d:\Code Project\ARM\IOToggle\Project\USER\main.c:60
            //this.matchers.set('breakpoint_Hit', new RegExp(/^Breakpoint ([0-9]+), \b\w+\b \((.*)\)\s+at (.+):([0-9]+)$/, 'g'));
            //$2 = 1000
            'Exp_Integer': new RegExp(/^(.+)\s*=\s*(-?\s*[0-9]+)\s*$/),
            'Exp_Hex': new RegExp(/^(.+)\s*=\s*((?:0x|0X)[0-9a-fA-F]+)\s*$/),
            'Exp_Float': new RegExp(/^(.+)\s*=\s*(-?\s*[0-9]+\.[0-9]+)\s*$/),
            //$1 = {a = {0 <repeats 12 times>}, s = 0x0, TIM_InitData = {TIM_Prescaler = 0, TIM_CounterMode = 0, TIM_Period = 0, 
            //TIM_ClockDivision = 0, TIM_RepetitionCounter = 0 '\000'}}
            'Exp_Object': new RegExp(/^\s*(.+)\s*=\s*(\{\s*\w+\s*=.+\})\s*$/),
            'Exp_Array': new RegExp(/^\s*(.+)\s*=\s*(\{[^=]+\}|".+")\s*$/),
            //'Exp_NumberArray': new RegExp(/^\s*(.+)\s*=\s*\{([0-9\.,\s]+)\}\s*$/),
            //$3 = "\000\000\000\000\001\002\003\004\001\002\003\004\006\a\b\t"
            //'Exp_charArray': new RegExp(/^(.+)\s*=\s*"(.*)"\s*$/),
            //other
            'Variables_Define': new RegExp(/^\s*(?:\s*\b[a-zA-Z_]\w*\b\s*)+\b([a-zA-Z_]\w*)\s*(\[[0-9]+\])?.*;\s*$/),
            //#0  InitADC () at d:\Code Project\ARM\IOToggle\Project\USER\main.c:116
            //#1  0x08002562 in SysTick_Handler () at d:\Code Project\ARM\IOToggle\Project\STARTUP\/startup_MM32F103.s:156
            //5-6
            'Call_Stack': new RegExp(/^#([0-9]+)\s+(?:(0x[0-9]+)\s*in)?\s*(\w+)\s*.*at (.*):([0-9]+)$/),
            'Value_Registers': new RegExp(/^(\w+)\b\s+(0x[0-9]+).*$/)
        };
    }
    UnFoldRepeat(str) {
        return str.replace(new RegExp(/\{\s*.+\s*<repeats\s*[0-9]+\s*times>\}/, 'g'), (s) => {
            let res = '[';
            let reg = new RegExp(/\{\s*(.+)\s*<repeats\s*([0-9]+)\s*times>\}/, 'g');
            let rList = reg.exec(s);
            if (rList && rList.length == 3) {
                let content = '', prefix = '', borderPos = 0;
                let cList = rList[1].split('');
                let cStack = [];
                for (let i = cList.length - 1; i >= 0; i--) {
                    if (cList[i] === '{') {
                        if (cStack.pop() === undefined) {
                            borderPos = i;
                            break;
                        }
                    }
                    if (cList[i] === '}') {
                        cStack.push('}');
                    }
                    content = cList[i] + content;
                }
                prefix = '{' + cList.splice(0, borderPos).join('');
                res = prefix + res;
                let num = Number.parseInt(rList[2]);
                if (num !== NaN) {
                    for (let i = 0; i < num; i++) {
                        res += content + (i === num - 1 ? '' : ',');
                    }
                    return res + ']';
                }
            }
            return s;
        });
    }
    ToJsonString(str) {
        let res = str.replace(new RegExp(/[\$\w]+\s*=/, 'g'), (str) => {
            let list = /([\$\w]+)\s*=/.exec(str);
            return '"' + list[1] + '" =';
        }).replace(/=\s*[a-zA-Z_]\w*(}|,)/g, (s) => {
            let list = /=\s*([a-zA-Z_]\w*)(}|,)/.exec(s);
            return '="' + list[1] + '"' + list[2];
        }).replace(new RegExp(/(?:0x|0X)[0-9a-fA-F]+/, 'g'), (str) => {
            return Number.parseInt(str, 16).toString();
        }).replace(new RegExp(/=/, 'g'), ':');
        return res;
    }
    IsExpression(str) {
        return this._matcher['is_expression'].test(str);
    }
    IsNumber(str) {
        return this.IsInteger(str) || this.IsFloat(str) || this.IsHex(str);
    }
    IsInteger(str) {
        return this._matcher['Exp_Integer'].test(str);
    }
    IsHex(str) {
        return this._matcher['Exp_Hex'].test(str);
    }
    IsFloat(str) {
        return this._matcher['Exp_Float'].test(str);
    }
    IsArray(str) {
        return this._matcher['Exp_Array'].test(str);
    }
    IsFileNoSymbol(strList) {
        let r = this._matcher['file_No_Symbol'];
        for (let i = 0; i < strList.length; i++) {
            if (r.test(strList[i])) {
                return true;
            }
        }
        return false;
    }
    ParseToVariablesDefine(strList) {
        let res = [];
        let reg = this._matcher['Variables_Define'];
        let list;
        strList.forEach((str) => {
            list = reg.exec(str);
            if (list && list.length === 3) {
                res.push({
                    name: list[1].trim(),
                    isArray: list[2] !== undefined
                });
            }
        });
        return res;
    }
    ParseToRegisterValue(strList) {
        let res = [];
        let reg = this._matcher['Value_Registers'];
        let list;
        strList.forEach((str) => {
            list = reg.exec(str);
            if (list && list.length === 3) {
                res.push({
                    name: list[1].trim(),
                    dataType: 'integer',
                    val: list[2].trim()
                });
            }
        });
        return res;
    }
    ParseToStacks(strList) {
        let res = [];
        let reg = this._matcher['Call_Stack'];
        let list;
        strList.forEach((str) => {
            list = reg.exec(str);
            if (list && list.length === 6) {
                res.push({
                    addr: list[2] ? list[2].trim() : '0x00000000',
                    id: Number.parseInt(list[1].trim()),
                    func: list[3].trim(),
                    args: [],
                    file: list[4].trim(),
                    line: list[5].trim()
                });
            }
        });
        return res;
    }
    ParseToBreakpointInfo(strList) {
        let res;
        let reg = this._matcher['breakpoint_Set'];
        let list;
        strList.forEach((str) => {
            list = reg.exec(str);
            if (list && list.length === 5) {
                res = {
                    id: Number.parseInt(list[1].trim()),
                    verified: true,
                    source: list[3].trim(),
                    lineNum: Number.parseInt(list[4].trim())
                };
            }
        });
        return res;
    }
    _parseValue(str) {
        let expr;
        let list;
        if (this.IsNumber(str)) {
            if (this.IsInteger(str)) {
                list = this._matcher['Exp_Integer'].exec(str);
                expr = {
                    dataType: 'integer',
                    name: list[1].trim(),
                    val: list[2].trim()
                };
            }
            else if (this.IsHex(str)) {
                list = this._matcher['Exp_Hex'].exec(str);
                expr = {
                    dataType: 'integer',
                    name: list[1].trim(),
                    val: list[2].trim()
                };
            }
            else {
                list = this._matcher['Exp_Float'].exec(str);
                expr = {
                    dataType: 'float',
                    name: list[1].trim(),
                    val: list[2].trim()
                };
            }
        }
        else if (this.IsArray(str)) {
            let list = this._matcher['Exp_Array'].exec(str);
            expr = {
                dataType: 'array',
                name: list[1].trim(),
                val: ''
            };
            let res = list[2];
            if (res.charAt(0) === '"') {
                expr.dataType = 'char_array';
                res = this.ConvertCharArray(res);
            }
            else {
                res = this.ConvertCharArray(res);
                res = this.ToJsonString(this.UnFoldRepeat(res));
                res = res.replace(/^\s*{/g, '[')
                    .replace(/}\s*$/g, ']');
            }
            expr.val = res;
        }
        else {
            let list = this._matcher['Exp_Object'].exec(str);
            expr = {
                dataType: 'object',
                name: list[1].trim(),
                val: this.ToJsonString(this.UnFoldRepeat(list[2]))
            };
        }
        return expr;
    }
    ConvertCharArray(_str) {
        return _str.replace(/"[^"]+"/g, (str) => {
            let s = str.substr(1, str.length - 2);
            s = s.replace(/\\\\([0-9]+|[a-zA-Z])/g, (partStr) => {
                let cList = /\\\\([0-9]+|[a-zA-Z])/.exec(partStr);
                if (cList[1].length === 1) {
                    return cList[1].charCodeAt(0).toString() + ',';
                }
                else {
                    return Number.parseInt(cList[1]).toString() + ',';
                }
            }).replace(/,\s*$/g, '');
            return '[' + s + ']';
        });
    }
    ParseToValue(strList) {
        let res = [];
        let expr;
        strList.forEach((str) => {
            if (this.IsExpression(str)) {
                expr = this._parseValue(str);
                if (expr) {
                    res.push(expr);
                }
            }
        });
        return res;
    }
}
//# sourceMappingURL=GDBTextParser.js.map