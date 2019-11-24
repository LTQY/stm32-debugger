import * as xml2js from 'x2js';
import { File } from '../lib/node-utility/File';

export interface PeripheralField {
    name: string;
    bitOffset: number;
    size: number;
}

export interface PeripheralRegister {
    name: string;
    offset: number;
    size: number;
    fields: PeripheralField[]
}

export interface Peripheral {
    name: string;
    baseAddr: number;
    blockSize: number;
    registers: PeripheralRegister[]
}

export class SVDParer {

    private peripheralList: Peripheral[];
    private xmlParser: xml2js;

    constructor() {
        this.peripheralList = [];
        this.xmlParser = new xml2js({
            arrayAccessFormPaths: ['device.peripherals.peripheral.registers.register.fields.field'],
            attributePrefix: '$'
        });
    }

    GetPeripheralList(): Peripheral[] {
        return this.peripheralList;
    }

    Parse(svdFile: File): boolean {

        let allDone: boolean = true;

        let doc = this.xmlParser.xml2js<any>(svdFile.Read());

        this.peripheralList = [];

        (<any[]>doc.device.peripherals.peripheral).forEach(peripheral => {

            if (peripheral.registers && peripheral.registers.register) {

                const _per: Peripheral = {
                    name: peripheral.name,
                    baseAddr: parseInt(peripheral.baseAddress),
                    blockSize: 0,
                    registers: []
                };

                (<any[]>peripheral.registers.register).forEach(reg => {

                    try {

                        const _reg: PeripheralRegister = {
                            name: reg.name,
                            offset: parseInt(reg.addressOffset),
                            size: parseInt(reg.size),
                            fields: []
                        };

                        (<any[]>reg.fields.field).forEach(field => {

                            _reg.fields.push({
                                name: field.name,
                                bitOffset: parseInt(field.bitOffset),
                                size: parseInt(field.bitWidth)
                            });

                        });

                        _per.registers.push(_reg);

                    } catch (error) {

                        console.error(error);

                        allDone = false;
                    }
                });

                this.peripheralList.push(_per);
            }
        });

        return allDone;
    }
}