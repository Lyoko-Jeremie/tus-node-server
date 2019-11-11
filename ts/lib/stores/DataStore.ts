/**
 * @fileOverview
 * Based store for all DataStore classes.
 *
 * @author Ben Stahl <bhstahl@gmail.com>
 */

import {Uid} from '../models/Uid';
import {File} from '../models/File';
import {EventEmitter} from 'events';
import {ERRORS, EVENTS} from '../constants';
import * as debug from 'debug';

const log = debug('tus-node-server:stores');

export type DataStoreOptType = { path: string, namingFunction?: Function, relativeLocation?: boolean };

export class DataStore extends EventEmitter {
    path: string;
    generateFileName;
    relativeLocation;
    _extensions;

    constructor(options: DataStoreOptType) {
        super();
        if (!options || !options.path) {
            throw new Error('Store must have a path');
        }
        if (options.namingFunction && typeof options.namingFunction !== 'function') {
            throw new Error('namingFunction must be a function');
        }
        this.path = options.path;
        this.generateFileName = options.namingFunction || Uid.rand;
        this.relativeLocation = options.relativeLocation || false;
    }

    get extensions() {
        if (!this._extensions) {
            return null;
        }
        return this._extensions.join();
    }

    set extensions(extensions_array) {
        if (!Array.isArray(extensions_array)) {
            throw new Error('DataStore extensions must be an array');
        }
        this._extensions = extensions_array;
    }

    /**
     * Called in POST requests. This method just creates a
     * file, implementing the creation extension.
     *
     * http://tus.io/protocols/resumable-upload.html#creation
     *
     * @param  {object} req http.incomingMessage
     * @return {Promise}
     */
    async create(req): Promise<File> {
        const upload_length = req.headers['upload-length'];
        const upload_defer_length = req.headers['upload-defer-length'];
        const upload_metadata = req.headers['upload-metadata'];

        if (upload_length === undefined && upload_defer_length === undefined) {
            return Promise.reject(ERRORS.INVALID_LENGTH);
        }

        const file_id = this.generateFileName(req);
        const file = new File(file_id, upload_length, upload_defer_length, upload_metadata);

        this.emit(EVENTS.EVENT_FILE_CREATED, {file});
        return Promise.resolve(file);
    }

    /**
     * Called in PATCH requests. This method should write data
     * to the DataStore file, and possibly implement the
     * concatenation extension.
     *
     * http://tus.io/protocols/resumable-upload.html#concatenation
     *
     * @param  {object} req http.incomingMessage
     * @return {Promise}
     */
    async write(req, file_id: string, offset: number): Promise<number> {
        log('[DataStore] write');
        // Stub resolve for tests
        offset = 0;

        this.emit(EVENTS.EVENT_UPLOAD_COMPLETE, {file: null});
        return Promise.resolve(offset);
    }

    /**
     * Called in HEAD requests. This method should return the bytes
     * writen to the DataStore, for the client to know where to resume
     * the upload.
     *
     * @param  {string} id     filename
     * @return {Promise}       bytes written
     */
    async getOffset(id): Promise<{ [key: string]: number }> {
        if (!id) {
            return Promise.reject(ERRORS.FILE_NOT_FOUND);
        }

        return Promise.resolve({size: 0, upload_length: 1});
    }
}

