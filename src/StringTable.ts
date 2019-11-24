import * as vscode from 'vscode';

export enum LanguageIndexs {
    Chinese = 0,
    English
}

let langIndex: number = /zh-cn/.test(vscode.env.language)
    ? LanguageIndexs.Chinese : LanguageIndexs.English;

//-----------------string table----------
export const upload_hint_txt = [
    '调试器在 5min 之内已经崩溃了 ${num} 次, 您可以选择提交错误日志帮助改进此插件, 抱歉',
    'The debugger crashed ${num} times in less than 5 minutes, and you have the option of submitting an error log to help improve the plug-in, sorry'
][langIndex];

export const parse_svdFile_failed = [
    'SVD文件解析错误: ',
    'Parse SVD file failed: '
][langIndex];

export const parse_svdFile_warning = [
    'SVD 部分解析错误: ',
    'Partial error on Parse SVD file : '
][langIndex];

export const receive_signal = [
    '程序接收到终止信号: ',
    'Program received exit signal: '
][langIndex];

export const program_exit = [
    '程序已终止',
    'Program exit'
][langIndex];

export const create_new_config = [
    '创建新的配置',
    'Create a new STM32 config'
][langIndex];

export const has_no_config = [
    '没有可用的调试配置',
    'No debug configuration is available'
][langIndex];

export const select_a_config = [
    '选择一个已有的调试配置',
    'Select an existing debug configuration'
][langIndex];

export const config_name_not_be_empty = [
    '配置名不能为空',
    'The configuration name cannot be empty'
][langIndex];

export const unsupported_chip_type = [
    '不支持的的芯片类型',
    'Unsupported chip type'
][langIndex];

export const unsupported_storage_mode = [
    '不支持的储存模式',
    'Unsupported storage mode'
][langIndex];

export const unsupported_debug_protocol = [
    '不支持的调试器协议',
    'Unsupported debug protocol'
][langIndex];

export const unsupported_transmission_speed = [
    '传输速度必须为整数',
    'The transmission speed must be an integer'
][langIndex];

export const invalid_elf_file_path = [
    '无效的elf文件路径',
    'Invalid elf file path'
][langIndex];

export const invalid_svd_file_path = [
    '无效的svd文件路径',
    'Invalid svd file path'
][langIndex];

//-----------------------------------

export const input_config_name = [
    '输入一个配置名称',
    'Input a STM32 config name'
][langIndex];

export const name_clash = [
    '名称冲突',
    'Name conflicting'
][langIndex];

export const transfer_speed = [
    '传输速度 默认 4000, 单位: KHZ',
    'Transmission speed, default: 4000, unit: KHZ'
][langIndex];

export const transfer_speed_hit = [
    '传输速度应该在 100 ~ 10000 之间',
    'The transmission speed should be between 100 and 10000'
][langIndex];

export const is_init_registers = [
    '是否初始化寄存器, 默认 false',
    'Whether to initialize register ? , default: false'
][langIndex];

export const elf_path_hit = [
    '调试文件(.elf)绝对路径, 此调试文件必须含有调试符号',
    'Absolute path to the debug file (.elf), which must contain the debug symbol'
][langIndex];

export const debug_protocol_name = [
    '调试协议名, 可选 SWD, JTAG, cJTAG, FINE, ICSP',
    'Debug protocol name, optional list: SWD, JTAG, cJTAG, FINE, ICSP'
][langIndex];

export const endian_mode = [
    '大端或者小端模式, 默认小端模式',
    'Big-endian or small-endian mode, default: small-endian mode'
][langIndex];

export const mcu_model = [
    '芯片型号',
    'MCU type'
][langIndex];

export const config_name = [
    '配置名, 用以区分其他配置',
    'Configuration name, to distinguish other configurations'
][langIndex];

export const WARNING = [
    '警告',
    'Warning'
][langIndex];

export const ERROR = [
    '错误',
    'Error'
][langIndex];

export const INFORMATION = [
    '消息',
    'Information'
][langIndex];
