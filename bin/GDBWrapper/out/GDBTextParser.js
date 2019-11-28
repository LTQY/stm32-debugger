"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const GlobalEvents_1 = require("./GlobalEvents");
class ESCReplacer {
    constructor() {
        this.escMap = {
            '"': /\\"/g,
            '\'': /\\'/g,
            '\\': /\\{2}/g,
            '': /\\n$/g,
            '\t': /\\t/g
        };
    }
    _reset() {
        for (let key in this.escMap) {
            this.escMap[key] = new RegExp(this.escMap[key].source, 'g');
        }
    }
    replace(str) {
        let res = str;
        for (let key in this.escMap) {
            res = res.replace(this.escMap[key], key);
        }
        this._reset();
        return res;
    }
}
class GDBTextParser {
    constructor() {
        this._matcher = new ExpressionMatcher();
        this.escReplacer = new ESCReplacer();
    }
    Parse(command, lines) {
        let response = {
            command: command,
            status: { isDone: true }
        };
        let sList = [];
        lines.slice(1).forEach((_str) => {
            const flag = _str[0];
            let line = _str.substr(1);
            /*
             * *: "bpHit"
             * =: "notify"
             * ~: "console"
             * @: "target"
             * &: "log"
             * ^: finish flag
             */
            switch (flag) {
                case '~':
                case '&':
                    line = line.substr(1, line.length - 2);
                    break;
                default:
                    break;
            }
            switch (command) {
                case 'info locals':
                case 'print':
                    line = line.replace(/\\n$/g, '')
                        .replace(/(?<!\\)\\"/g, '"');
                    break;
                case 'target remote':
                case '###':
                    line = line.replace(/\\n$/g, '');
                    break;
                default:
                    line = this.escReplacer.replace(line);
                    break;
            }
            switch (flag) {
                case '*':
                    response.runningStatus = this.ParseToRunningStatus(line);
                    break;
                case '^':
                    response.status = this.ParseExecStatus(line);
                    break;
                case '&':
                case '~':
                    sList.push(line);
                    break;
                default:
                    break;
            }
        });
        switch (command) {
            case '###':
            case 'target remote':
                // do nothing
                break;
            default:
                {
                    if (response.status.isDone) {
                        try {
                            this.ParseToResult(response, sList);
                        }
                        catch (error) {
                            response.status.isDone = false;
                            response.status.msg = error instanceof Error ? error.message
                                : '[' + GDBTextParser.name + '] : error on method: ' + this.ParseToResult.name;
                            GlobalEvents_1.GlobalEvent.emit('log', { type: 'Error', line: JSON.stringify(error) });
                        }
                    }
                }
                break;
        }
        return response;
    }
    ParseExecStatus(line) {
        let status = { isDone: true };
        let list = /^error,msg=(.+)/.exec(line);
        if (list) {
            status.isDone = false;
            status.msg = list[1].replace(/\\[0-9]+/g, (str) => {
                return String.fromCharCode(Number.parseInt(str.substr(1)));
            });
        }
        return status;
    }
    //*stopped,frame={addr="0x08000430",func="main",args=[],file="d:\\Code Project\\ARM\\demo\\.\\src\\main.c",fullname="d:\\Code Project\\ARM\\demo\\src\\main.c",line="28",arch="armv3m"},thread-id="1",stopped-threads="all"
    ParseToRunningStatus(line) {
        let list = /^(\w+),(.+)$/g.exec(line.trim());
        let str = '{' + list[2] + '}';
        str = str.replace(/[\w-]+=/g, (val) => {
            return '"' + val.substr(0, val.length - 1).replace(/-/g, '_') + '":';
        });
        str = str.replace(/".*?"/g, (val) => {
            return val.replace(/(?<!\\)\\(?!\\|"|')/g, '\\\\');
        });
        let hitInfo = {
            type: list[1],
            info: {}
        };
        hitInfo.info = JSON.parse(str);
        return hitInfo;
    }
    ParseToResult(response, lines) {
        switch (response.command) {
            case 'file':
                if (this._matcher.IsFileNoSymbol(lines)) {
                    response.status.isDone = false;
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
                if (response.result === undefined) {
                    response.status.isDone = false;
                    response.status.msg = lines.join(' ; ');
                }
                break;
            case 'x':
                response.result = this._matcher.ParseToMemoryValue(lines);
                break;
            default:
                GlobalEvents_1.GlobalEvent.emit('log', { type: 'Warning', line: '[' + GDBTextParser.name + '] : ignore command \'' + response.command + '\'' });
                break;
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
            'file_No_Symbol': /No debugging symbols found/i,
            'is_expression': /^.+\s*=\s*.+$/,
            //this.matchers.set('not_found_variables', new RegExp(/^No symbol .* in current context.*$/));
            //Breakpoint 1 at 0x8002454: file d:\Code Project\ARM\IOToggle\Project\USER\main.c, line 62.
            //
            'breakpoint_Set': /^Breakpoint ([0-9]+) at (0x[0-9a-f]+): file (.+), line ([0-9]+).$/,
            //Breakpoint 2, main () at d:\Code Project\ARM\IOToggle\Project\USER\main.c:60
            //this.matchers.set('breakpoint_Hit', new RegExp(/^Breakpoint ([0-9]+), \b\w+\b \((.*)\)\s+at (.+):([0-9]+)$/, 'g'));
            //0xbffff2ec:    0x00282ff4    0x080484e0
            'Memory_Value': /\s*[0-9a-fA-FxX]+\s*:\s*([0-9a-fA-FxX]+)\s*/,
            'Exp_Optimized': /^([^=]+)\s*=\s*(<optimized out>).*$/,
            //$2 = 1000
            'Exp_Integer': /^([^=]+)\s*=\s*(-?\s*[0-9]+)\s*$/,
            'Exp_Hex': /^([^=]+)\s*=\s*((?:0x|0X)[0-9a-fA-F]+)\s*$/,
            'Exp_Float': /^([^=]+)\s*=\s*(-?\s*[0-9]+\.[0-9]+)\s*$/,
            //$1 = {a = {0 <repeats 12 times>}, s = 0x0, TIM_InitData = {TIM_Prescaler = 0, TIM_CounterMode = 0, TIM_Period = 0, 
            //TIM_ClockDivision = 0, TIM_RepetitionCounter = 0 '\000'}}
            'Exp_Object': /^\s*([^=]+)\s*=\s*(\{\s*\w+\s*=.+\})\s*$/,
            //$1 = {{a=0},{a=0}};
            'Exp_Array': /^\s*([^=]+)\s*=\s*(\{["\{0-9].*\})\s*$/,
            'Default_Matcher': /^\s*([^=]+)\s*=\s*(.*)\s*$/,
            //$3 = "\000\000\000\000\001\002\003\004\001\002\003\004\006\a\b\t"
            //$5 = \"\\377\\377\\377\\377\\377\"
            'Exp_String': /^\s*([^=]+)\s*=\s*"(.+)"\s*$/,
            //other
            'Variables_Define': /^\s*(?:\s*\b[a-zA-Z_]\w*\b\s*)+\b([a-zA-Z_]\w*)\s*(\[[0-9]+\])?.*;\s*$/,
            //#0  InitADC () at d:\Code Project\ARM\IOToggle\Project\USER\main.c:116
            //#1  0x08002562 in SysTick_Handler () at d:\Code Project\ARM\IOToggle\Project\STARTUP\/startup_MM32F103.s:156
            //5-6
            'Call_Stack': /^#([0-9]+)\s+(?:(0x[0-9]+)\s*in)?\s*(\w+)\s*.*at (.*):([0-9]+)\s*$/,
            'Value_Registers': /^(\w+)\b\s+(0x[0-9]+).*$/
        };
    }
    ToJsonString(str) {
        let res = str.replace(/".*?"/g, (val) => {
            return val.replace(/(?<!\\)\\(?!\\)/g, '\\\\');
        });
        // variables name
        res = res.replace(/(?<!")(?:[a-z_]|0x)\w*(?=[^"]?\s*=)/gi, (name) => { return '"' + name + '"'; });
        // variables val
        res = res.replace(/(?<==\s*[^"\{\[])(?:[a-z_]|0x)\w*(?!")/gi, (val) => { return '"' + val + '"'; });
        // replace '=' to ':'
        res = res.replace(/(?<!"\s*)"\w+"\s*=/g, (expr) => {
            return expr.replace(/=/g, ':');
        });
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
    IsString(str) {
        return this._matcher['Exp_String'].test(str);
    }
    IsOptimized(expr) {
        return this._matcher['Exp_Optimized'].test(expr);
    }
    IsObject(expr) {
        return this._matcher['Exp_Object'].test(expr);
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
    ParseToMemoryValue(lines) {
        const res = [];
        const reg = this._matcher['Memory_Value'];
        let list;
        lines.forEach(line => {
            list = reg.exec(line);
            if (list && list.length > 1) {
                res.push({
                    name: 'result',
                    dataType: 'integer',
                    val: list[1].trim()
                });
            }
        });
        return res.length > 0 ? res : undefined;
    }
    _PreHandleArray(sepPair, str) {
        const rangeList = [];
        const cSatck = [];
        const strArr = Array.from(str);
        const _isBorder = (index, arr) => {
            const nChar = arr[index + 1];
            return nChar === '{' || /[0-9]/.test(nChar) || nChar === '"';
        };
        strArr.forEach((char, index) => {
            if (char === '{') {
                cSatck.push({
                    char: char,
                    index: index,
                    isBorder: _isBorder(index, strArr)
                });
            }
            else if (char === '}') {
                const range = cSatck.pop();
                if (range.isBorder) {
                    rangeList.push({
                        start: range.index,
                        end: index
                    });
                }
            }
        });
        const res = Array.from(str);
        rangeList.forEach((range) => {
            res[range.start] = sepPair.first;
            res[range.end] = sepPair.second;
        });
        return res.join('');
    }
    _parseValue(str) {
        let expr;
        if (this.IsOptimized(str)) {
            const list = this._matcher['Exp_Optimized'].exec(str);
            expr = {
                dataType: 'original',
                name: list[1].trim() + ' <optimized out>',
                val: 'null'
            };
        }
        else if (this.IsNumber(str)) {
            if (this.IsInteger(str)) {
                const list = this._matcher['Exp_Integer'].exec(str);
                expr = {
                    dataType: 'integer',
                    name: list[1].trim(),
                    val: list[2].trim()
                };
            }
            else if (this.IsHex(str)) {
                const list = this._matcher['Exp_Hex'].exec(str);
                expr = {
                    dataType: 'integer',
                    name: list[1].trim(),
                    val: list[2].trim()
                };
            }
            else {
                const list = this._matcher['Exp_Float'].exec(str);
                expr = {
                    dataType: 'float',
                    name: list[1].trim(),
                    val: list[2].trim()
                };
            }
        }
        else if (this.IsArray(str)) {
            const list = this._matcher['Exp_Array'].exec(str);
            const sepPair = {
                first: '<0#0>',
                second: '<1#1>'
            };
            let res = this._PreHandleArray(sepPair, list[2].trim());
            res = this.ToJsonString(res);
            res = res.replace(new RegExp(sepPair.first, 'g'), '[')
                .replace(new RegExp(sepPair.second, 'g'), ']');
            expr = {
                dataType: 'array',
                name: list[1].trim(),
                val: res
            };
        }
        else if (this.IsString(str)) {
            const list = this._matcher['Exp_String'].exec(str);
            expr = {
                dataType: 'char_array',
                name: list[1].trim(),
                val: this.ConvertCharArray(list[2].trim())
            };
        }
        else if (this.IsObject(str)) {
            const list = this._matcher['Exp_Object'].exec(str);
            expr = {
                dataType: 'object',
                name: list[1].trim(),
                val: this.ToJsonString(list[2])
            };
        }
        else {
            const list = this._matcher['Default_Matcher'].exec(str);
            expr = {
                dataType: 'original',
                name: list[1].trim() + ' <original>',
                val: list[2].trim()
            };
        }
        return expr;
    }
    ConvertCharArray(_str) {
        let res = [];
        const _escMap = {
            '\\\\007': /\\{2}a/g,
            '\\\\010': /\\{2}b/g,
            '\\\\014': /\\{2}f/g,
            '\\\\012': /\\{2}n/g,
            '\\\\015': /\\{2}r/g,
            '\\\\011': /\\{2}t/g,
            '\\\\013': /\\{2}v/g,
            '\\\\047': /\\{3}'/g,
            '\\\\042': /\\{3}"/g,
            '\\\\134': /\\{4}/g
        };
        for (let key in _escMap) {
            _str = _str.replace(_escMap[key], key);
        }
        _str = _str.replace(/\\{2}/g, '\\');
        let escCount = 0;
        let isEscChar = false;
        let escString = '';
        for (let char of _str) {
            if (char === '\\') {
                isEscChar = true;
                escString = '';
                escCount = 0;
            }
            if (isEscChar) {
                escString += char;
                escCount++;
            }
            else {
                res.push(char.charCodeAt(0));
            }
            if (escCount === 4) {
                res.push(parseInt(escString.substr(1), 8));
                isEscChar = false;
                escString = '';
                escCount = 0;
            }
        }
        return '[' + res.join(',') + ']';
    }
    ParseToValue(_strList) {
        const uniqueSep = '<0#0>';
        const splitReg = new RegExp(uniqueSep, 'g');
        const isObjField = (_line) => {
            return /^,.*/.test(_line) || /^\w+\s+=\s+\{/.test(_line);
        };
        let strList = _strList.map((_val) => {
            if (_val !== '') {
                let sep;
                if (isObjField(_val)) {
                    sep = {
                        start: '"',
                        end: '"'
                    };
                }
                else {
                    sep = {
                        start: '',
                        end: ''
                    };
                }
                _val = _val.replace(/(?<==\s+)0x[0-9a-f]+\s+.+$/gi, (str) => {
                    const res = /0x[0-9a-f]+\s+(.*)/i.exec(str)[1].trim();
                    return /^".*"$/.test(res) ? res : (sep.start + res + sep.end);
                });
                _val = _val.replace(/(?<==\s+).+<repeats [0-9]+ times>$/g, (str) => {
                    return sep.start + str + sep.end;
                });
                _val = _val.replace(/(?<==\s+)[0-9]+\s+\'\\{2}[0-9]{3}\'$/g, (charVal) => {
                    return /^([0-9]+).*/.exec(charVal)[1];
                });
                return _val;
            }
            else {
                return uniqueSep;
            }
        });
        strList = strList.join('').split(splitReg).filter(v => { return v !== ''; });
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
        return res.length > 0 ? res : undefined;
    }
}
//# sourceMappingURL=GDBTextParser.js.map