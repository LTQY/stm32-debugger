//--------TCP-Format--------

export interface TCPData {
    tag: string;
    data: string;
}

export const tcpDataSeparator: string = '<sep>';

//------------------------


//------DebugProtocol----

export interface DebugContent {
    command: string;
    data: string;
}

export const BpHitCommand: GDBCommand = '###';

export type GDBCommand = 'file' | 'target remote' | 'load' | 'undisplay' |
    'break' | 'delete breakpoints' | 'continue' | 'stop' |
    'step' | 'step over' | 'info locals' | 'info variables' |
    'info stack' | 'print' | 'set' | 'info registers' | '###' | 'init' | 'pause' | 'x';

export interface BaseBreakPoint {
    source: string;
    verified: boolean;
    id?: number;
    lineNum?: number;
    isCondition?: boolean;
    condition?: string | null;
}

export type DataType = 'array' | 'object' | 'char_array' | 'integer' | 'float' | 'original';

export interface Expression {
    name: string;
    dataType: DataType;
    val: string;
}

export interface VariablesDefine {
    name: string;
    isArray: boolean;
}

//--------------

export interface CommandRequest {
    command: GDBCommand;
    params: string;
}

export interface GDBServerResponse {
    command: GDBCommand;
    result?: Expression[] | VariablesDefine[] | GDBFrame[] | BaseBreakPoint;
    status: ExecuteResult;
    runningStatus?: RunningStatus;
}

export interface ExecuteResult {
    isDone: boolean;
    msg?: string;
}

/*reason="breakpoint-hit",
 * disp="keep",
 * bkptno="1",
 * frame={
 * addr="0x08002446",
 * func="main",
 * args=[],
 * file="d:\\Code Project\\ARM\\IOToggle\\Project\\USER\\main.c",
 * fullname="d:\\Code Project\\ARM\\IOToggle\\Project\\USER\\main.c",
 * line="61",
 * arch="armv3m"
 * },
 * thread-id="1",
 * stopped-threads="all"*/

export interface RunningStatus {
    type: string;
    info: RunningInfo;
}

export interface RunningInfo {
    reason?: string;
    signal_name?: string;
    disp?: string;
    bkptno?: string;
    frame?: GDBFrame;
    thread_id?: string;
    stopped_threads?: string;
}

export interface FunctionArgs {
    name: string;
    value: string;
}

export interface GDBFrame {
    addr: string;
    func: string;
    args: FunctionArgs[];
    file?: string;
    fullname?: string;
    id?: number;
    line?: string;
    arch?: string;
}
