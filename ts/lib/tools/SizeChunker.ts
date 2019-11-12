/***
 * code base come from a old lib https://github.com/Olegas/node-chunking-streams  's  SizeChunker
 *
 * fix some bad design, fis some deprecated code, translate to TypeScript
 *
 */
import {Transform, TransformCallback} from 'stream';


export class SizeChunker extends Transform {
    _bytesPassed;
    _currentChunk;
    _lastEmittedChunk;
    _chunkSize;
    _flushTail;

    constructor(options?: { chunkSize: number, flushTail?: boolean }) {
        super(Object.assign({readableObjectMode: true}, options));

        this._bytesPassed = 0;
        this._currentChunk = -1;
        this._lastEmittedChunk = undefined;
        this._chunkSize = +(options && options.chunkSize);
        this._flushTail = (options && options.flushTail) || false;

        if (isNaN(this._chunkSize) || this._chunkSize <= 0) {
            throw new Error('Invalid chunk size. Must be a number greater than zero.');
        }

        // use _final replace this
        // this.once('end', () => {
        //     if (this._flushTail && (this._lastEmittedChunk !== undefined) && this._bytesPassed > 0) {
        //         this.emit('chunkEnd', this._currentChunk, nop);
        //     }
        // });
    }

    _finishChunk(done: (error?: Error | null) => void) {
        if (this.listenerCount('chunkEnd') > 0) {
            this.emit('chunkEnd', this._currentChunk, (error?: Error | null) => {
                if (error) {
                    done(error);
                    return;
                }
                this._bytesPassed = 0;
                this._lastEmittedChunk = undefined;
                done(undefined);
            });
        } else {
            this._bytesPassed = 0;
            this._lastEmittedChunk = undefined;
            done(undefined);
        }
    }

    _startChunk(done) {
        this._currentChunk++;
        if (this.listenerCount('chunkStart') > 0) {
            this.emit('chunkStart', this._currentChunk, done);
        } else {
            done();
        }
    }

    _pushData(buf) {
        this.push({
            data: buf,
            id: this._currentChunk
        });

        this._bytesPassed += buf.length;
    }

    _startIfNeededAndPushData(buf) {
        if (this._lastEmittedChunk != this._currentChunk) {
            this._startChunk(() => {
                this._lastEmittedChunk = this._currentChunk;
                this._pushData(buf);
            });
        } else {
            this._pushData(buf);
        }
    }

    _transform(chunk, encoding, done: TransformCallback) {
        const _do_transform = (error?: Error | null) => {
            if (error) {
                done(error);
                return;
            }

            const bytesLeave = Math.min(chunk.length, this._chunkSize - this._bytesPassed);

            if (this._bytesPassed + chunk.length < this._chunkSize) {
                this._startIfNeededAndPushData(chunk);
                done(undefined);
            } else {
                const remainder = bytesLeave - chunk.length;

                if (remainder === 0) {
                    this._startIfNeededAndPushData(chunk);
                    this._finishChunk(done);
                } else {
                    this._startIfNeededAndPushData(chunk.slice(0, bytesLeave));
                    chunk = chunk.slice(bytesLeave);
                    this._finishChunk(_do_transform);
                }
            }
        };

        _do_transform();
    }

    _final(callback: (error?: (Error | null)) => void): void {
        if (this._flushTail && (this._lastEmittedChunk !== undefined) && this._bytesPassed > 0) {
            this.emit('chunkEnd', this._currentChunk, callback);
        }
    }

}
