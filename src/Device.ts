import * as Process from 'child_process';
import * as ReadLine from 'readline';

export const InvalidUUID = 'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF';

export function AsyncGetUUID(): Promise<string> {

    return new Promise((resolve) => {
        //wmic csproduct get UUID

        let done: boolean = false;

        const proc = Process.exec('wmic csproduct get UUID', { windowsHide: true });

        proc.stdout.setEncoding('utf8');
        let stdout = ReadLine.createInterface(proc.stdout);

        proc.on('close', () => {
            if (!done) {
                resolve(InvalidUUID);
            }
        });

        stdout.on('line', (line) => {
            line = line.trim();
            if (/^[a-zA-Z0-9]{8}-[a-zA-Z0-9]{4}-[a-zA-Z0-9]{4}-[a-zA-Z0-9]{4}-[a-zA-Z0-9]{12}$/.test(line)) {
                done = true;
                resolve(line);
            }
        });

    });
}

export function GetUUID(): string {
    const buf: string = Process.execSync('wmic csproduct get UUID', { windowsHide: true, encoding: 'utf8' }).toString();
    const list = buf.match(/[a-zA-Z0-9]{8}-[a-zA-Z0-9]{4}-[a-zA-Z0-9]{4}-[a-zA-Z0-9]{4}-[a-zA-Z0-9]{12}/);
    return list ? list[0] : InvalidUUID;
}