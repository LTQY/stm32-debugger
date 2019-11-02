"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
let instance;
var TimeFieldType;
(function (TimeFieldType) {
    TimeFieldType[TimeFieldType["YEAR"] = 0] = "YEAR";
    TimeFieldType[TimeFieldType["MONTH"] = 1] = "MONTH";
    TimeFieldType[TimeFieldType["DATE"] = 2] = "DATE";
    TimeFieldType[TimeFieldType["HOUR"] = 3] = "HOUR";
    TimeFieldType[TimeFieldType["MINUTE"] = 4] = "MINUTE";
    TimeFieldType[TimeFieldType["SECOND"] = 5] = "SECOND";
    TimeFieldType[TimeFieldType["REGION"] = 6] = "REGION";
})(TimeFieldType = exports.TimeFieldType || (exports.TimeFieldType = {}));
class TimeData {
    constructor(timeInfo) {
        this.time = timeInfo;
    }
    GetTimeInfo() {
        return this.time;
    }
    Increase(fieldType, number) {
        if (!Number.isInteger(number)) {
            throw new Error('The increase number of time must be integer');
        }
        switch (fieldType) {
            case TimeFieldType.YEAR:
                this.time.year += number;
                break;
            case TimeFieldType.MONTH:
                this.IncreaseMonth(number);
                break;
            case TimeFieldType.DATE:
                this.IncreaseDate(number);
                break;
            case TimeFieldType.HOUR:
                this.IncreaseHour(number);
                break;
            case TimeFieldType.MINUTE:
                this.IncreaseMinute(number);
                break;
            case TimeFieldType.SECOND:
                this.IncreaseSecond(number);
                break;
            default:
                break;
        }
    }
    Compare(timeInfo) {
        let current = this.GetTimeInfo();
        if (current.year !== timeInfo.year) {
            return current.year - timeInfo.year;
        }
        if (current.month !== timeInfo.month) {
            return current.month - timeInfo.month;
        }
        if (current.date !== timeInfo.date) {
            return current.date - timeInfo.date;
        }
        if (current.hour !== timeInfo.hour) {
            return current.hour - timeInfo.hour;
        }
        if (current.minute !== timeInfo.minute) {
            return current.minute - timeInfo.minute;
        }
        if (current.second !== timeInfo.second) {
            return current.second - timeInfo.second;
        }
        return 0;
    }
    IncreaseMonth(number) {
        this.time.month += number;
        if (this.time.month > 12) {
            this.time.year += parseInt((this.time.month / 12).toString());
            this.time.month = this.time.month % 12;
        }
        else if (this.time.month < 1) {
            this.time.year += parseInt((this.time.month / 12).toString()) - 1;
            this.time.month = 12 + (this.time.month % 12);
        }
    }
    IncreaseDate(number) {
        if (number >= 0) {
            for (let i = 0; i < number; i++) {
                this.AddDate();
            }
        }
        else {
            for (let i = 0; i < -number; i++) {
                this.ReduceDate();
            }
        }
    }
    IncreaseHour(number) {
        this.time.hour += number;
        if (this.time.hour > 23) {
            this.IncreaseDate(parseInt((this.time.hour / 24).toString()));
            this.time.hour = this.time.hour % 24;
        }
        else if (this.time.hour < 0) {
            this.IncreaseDate(parseInt((this.time.hour / 24).toString()) - 1);
            this.time.hour = 23 + (this.time.hour % 24);
        }
    }
    IncreaseMinute(number) {
        this.time.minute += number;
        if (this.time.minute > 59) {
            this.IncreaseHour(parseInt((this.time.minute / 60).toString()));
            this.time.minute = this.time.minute % 60;
        }
        else if (this.time.minute < 0) {
            this.IncreaseHour(parseInt((this.time.minute / 60).toString()) - 1);
            this.time.minute = 59 + (this.time.minute % 60);
        }
    }
    IncreaseSecond(number) {
        this.time.second += number;
        if (this.time.second > 59) {
            this.IncreaseMinute(parseInt((this.time.second / 60).toString()));
            this.time.second = this.time.second % 60;
        }
        else if (this.time.second < 0) {
            this.IncreaseMinute(parseInt((this.time.second / 60).toString()) - 1);
            this.time.second = 59 + (this.time.second % 60);
        }
    }
    AddDate() {
        if (this.GetDateOfMonth() === this.time.date) {
            this.time.date = 1;
            this.IncreaseMonth(1);
        }
        else {
            this.time.date++;
        }
    }
    ReduceDate() {
        if (this.time.date === 1) {
            this.IncreaseMonth(-1);
            this.time.date = this.GetDateOfMonth();
        }
        else {
            this.time.date--;
        }
    }
    GetDateOfYear() {
        return this.time.year % 4 === 0 ? 366 : 365;
    }
    GetDateOfMonth() {
        switch (this.time.month) {
            case 4:
            case 6:
            case 9:
            case 11:
                return 30;
            case 2:
                return this.GetDateOfYear() === 366 ? 29 : 28;
            default:
                return 31;
        }
    }
}
exports.TimeData = TimeData;
class Time {
    constructor() {
        this.date = new Date();
        this.Separater = '|';
    }
    static GetInstance() {
        if (instance) {
            return instance;
        }
        instance = new Time();
        return instance;
    }
    GetTimeStamp() {
        this.date.setTime(Date.now());
        let dateStr = this.GetDateString();
        let tList = this.date.toTimeString().split(' ');
        dateStr += this.Separater + tList[0] + this.Separater + tList[1];
        return dateStr;
    }
    GetDateString() {
        return this.date.getFullYear().toString() + '/' + (this.date.getMonth() + 1).toString() + '/' + this.date.getDate().toString();
    }
    GetTimeInfo() {
        this.date.setTime(Date.now());
        return {
            year: this.date.getFullYear(),
            month: this.date.getMonth(),
            date: this.date.getDate(),
            hour: this.date.getHours(),
            minute: this.date.getMinutes(),
            second: this.date.getSeconds(),
            region: this.date.toTimeString().split(' ')[1]
        };
    }
    Parse(timeStamp) {
        let fieldList = timeStamp.split('|');
        let yearField = fieldList[0].split('/');
        let timeField = fieldList[1].split(':');
        return {
            year: Number.parseInt(yearField[0]),
            month: Number.parseInt(yearField[1]),
            date: Number.parseInt(yearField[2]),
            hour: Number.parseInt(timeField[0]),
            minute: Number.parseInt(timeField[1]),
            second: Number.parseInt(timeField[2]),
            region: fieldList[2]
        };
    }
    Stringify(timeData) {
        return timeData.year.toString() + '/' + timeData.month.toString() + '/' + timeData.date.toString() + '|'
            + timeData.hour.toString() + ':' + timeData.minute.toString() + ':' + timeData.second.toString() + '|'
            + timeData.region;
    }
    SetTimeSeparater(sep) {
        this.Separater = sep;
    }
    GetTimeSeparater() {
        return this.Separater;
    }
}
exports.Time = Time;
//# sourceMappingURL=Time.js.map