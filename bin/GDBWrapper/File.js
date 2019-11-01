"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const fs = require("fs");
class File {
    constructor(fPath) {
        this.fPath = fPath;
        this.name = path.basename(fPath);
        this.noSuffixName = this.name.split('.')[0];
        this.suffix = path.extname(fPath);
        this.dir = path.dirname(fPath);
    }
    Read() {
        return fs.readFileSync(this.fPath, {
            encoding: 'utf8'
        });
    }
    GetList() {
        let list = [];
        fs.readdirSync(this.fPath).forEach((str) => {
            if (str !== '.' && str !== '..') {
                list.push(new File(this.fPath + path.sep + str));
            }
        });
        return list;
    }
    Write(str) {
        fs.writeFileSync(this.fPath, str);
    }
    Append(str) {
        fs.appendFileSync(this.fPath, str);
    }
    IsExist() {
        return fs.existsSync(this.fPath);
    }
    IsFile() {
        return fs.lstatSync(this.fPath).isFile();
    }
    IsDir() {
        return fs.lstatSync(this.fPath).isDirectory();
    }
    ToUri() {
        return 'file://' + this.ToNoProtocolUri();
    }
    ToNoProtocolUri() {
        return '/' + this.fPath.replace(new RegExp(path.sep + path.sep, 'g'), '/');
    }
}
exports.File = File;
//# sourceMappingURL=File.js.map