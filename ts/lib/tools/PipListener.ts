import {Transform} from 'stream';
import * as moment from 'moment';
import {bufferTime, map, filter} from 'rxjs/operators';
import {Observable, Subject} from 'rxjs';
import {isNumber, isNil, isBoolean, isArray, isFunction} from 'lodash';

export interface PipListenerObservData {
    percentage: number;
    speed: number;
    nowSpeed: number;
    count: number;
    max: number;
    averageSpeed: number;
    averageTimeLeft: number;
    timeLeft: number;
}

export interface PipListenerConfig {
    bufferTimeInterval?: number;
    speedSmoothRate?: number;
    dontSendProgressDuringNoData?: boolean;
    dontBufferByTime?: boolean;
    isObjectMode?: boolean;
    chunkSizeCounter?: ((chunk: any) => number);
}

export class PipListener extends Transform {
    protected count = 0;
    protected max = 0;
    protected lastCheck = 0;
    protected lastSpeed = 0;
    protected lastSpeedSmoothRate = 0.5;
    protected bufferTimeInterval = 500;
    protected startTime: moment.Moment | undefined = undefined;
    protected endTime: moment.Moment | undefined = undefined;
    protected dontSendProgressDuringNoData: boolean = false;
    protected dontBufferByTime: boolean = false;

    constructor(max: number, beginOffset?: number, config?: PipListenerConfig) {
        super({
            readableObjectMode: (config && !!config.isObjectMode) || false,
            writableObjectMode: (config && !!config.isObjectMode) || false,
        });
        this.max = max;
        this.count = beginOffset || 0;
        config = config || {};
        if (isBoolean(config.dontSendProgressDuringNoData)) {
            this.dontSendProgressDuringNoData = config.dontSendProgressDuringNoData;
        }
        if (isBoolean(config.dontBufferByTime)) {
            this.dontBufferByTime = config.dontBufferByTime;
        }
        if (isNumber(config.bufferTimeInterval) && config.bufferTimeInterval > 0) {
            this.bufferTimeInterval = config.bufferTimeInterval;
        }
        if (isNumber(config.speedSmoothRate) && config.speedSmoothRate >= 0 && config.speedSmoothRate < 1) {
            this.lastSpeedSmoothRate = config.speedSmoothRate;
        } else if (isNumber(config.speedSmoothRate)) {
            console.warn('PipListener speedSmoothRate must >=0 and <1. but now it\'s' + config.speedSmoothRate);
        }
        if (isFunction(config.chunkSizeCounter)) {
            this.chunkSizeCounter = config.chunkSizeCounter;
        } else if (!!config.isObjectMode) {
            console.warn('PipListener chunkSizeCounter must isFunction when isObjectMode are true.');
        }
        this.once('error', err => this.subject.error(err));
        this.once('end', () => {
            this.endTime = moment();
            this.subject.complete();
        });

        let observable: Observable<number | number[]> = this.subject.asObservable();
        if (config.dontBufferByTime) {
            observable = (observable as Observable<number>).pipe(
                map(T => [T]),
            ) as Observable<number[]>;
        } else {
            observable = (observable as Observable<number>).pipe(
                bufferTime(this.bufferTimeInterval),
            ) as Observable<number[]>;
        }
        if (this.dontSendProgressDuringNoData) {
            observable = (observable as Observable<number[]>).pipe(
                filter((A: number[]) => {
                    if (this.dontSendProgressDuringNoData) {
                        return A.length > 0;
                    }
                    return true;
                }),
            ) as Observable<number[]>;
        }
        this.observable = (observable as Observable<number[]>).pipe(
            map((A: number[]): PipListenerObservData => {
                if (A.length > 0) {
                    const thisCheck = A[A.length - 1];
                    const lastCheck = this.lastCheck;
                    this.lastCheck = thisCheck;

                    const speed = (thisCheck - lastCheck) * (1000 / this.bufferTimeInterval);
                    this.lastSpeed = (this.lastSpeed * this.lastSpeedSmoothRate)
                        + (speed * (1 - this.lastSpeedSmoothRate));
                    const averageSpeed = this.count / moment().diff(moment(this.startTime)) * 1000.0;
                    const averageTimeLeft = (this.max - this.count) / (averageSpeed / 1000.0);
                    const timeLeft = (this.max - this.count) / (this.lastSpeed / 1000.0);
                    return {
                        // lastCheck: lastCheck,
                        // thisCheck: thisCheck,
                        count: this.count,
                        max: this.max,
                        percentage: thisCheck / this.max * 100,
                        speed: this.lastSpeed,
                        nowSpeed: speed,
                        averageSpeed: averageSpeed,
                        averageTimeLeft: averageTimeLeft,
                        timeLeft: timeLeft,
                    };
                } else {
                    return this.getLastState();
                }
            }),
        );
    }

    protected subject = new Subject<number>();
    protected observable: Observable<PipListenerObservData>;
    protected chunkSizeCounter: ((chunk: any) => number) = (chunk: any) => {
        return (chunk as ArrayBuffer).byteLength;
    };

    public getLastState() {
        const thisCheck = this.lastCheck;
        const speed = 0;
        this.lastSpeed = (this.lastSpeed * this.lastSpeedSmoothRate)
            + (speed * (1 - this.lastSpeedSmoothRate));
        let averageSpeed = this.count / moment().diff(moment(this.startTime)) * 1000.0;
        let averageTimeLeft = (this.max - this.count) / (averageSpeed / 1000.0);
        let timeLeft = (this.max - this.count) / (this.lastSpeed / 1000.0);
        if (this.endTime) {
            averageSpeed = this.count / this.endTime.diff(moment(this.startTime)) * 1000.0;
            averageTimeLeft = 0;
            timeLeft = 0;
        }
        return {
            count: this.count,
            max: this.max,
            percentage: thisCheck / this.max * 100,
            speed: this.lastSpeed,
            nowSpeed: speed,
            averageSpeed: averageSpeed,
            averageTimeLeft: averageTimeLeft,
            timeLeft: timeLeft,
        };
    }

    public asObservable() {
        return this.observable;
    }

    _transform(chunk: any, encoding: string, callback: (error?: (Error | null), data?: any) => void): void {
        if (isNil(this.startTime)) {
            this.startTime = moment();
        }
        this.push(chunk);
        this.count += this.chunkSizeCounter(chunk);
        // console.log({count: this.count, max: this.max});
        // console.log(this.count / this.max * 100, '%', this.count, this.max);
        this.subject.next(this.count);
        callback();
    }

    _flush(callback: (error?: (Error | null), data?: any) => void): void {
        callback();
    }
}

