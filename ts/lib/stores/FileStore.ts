import {DataStore, DataStoreOptType} from './DataStore';
import {File} from '../models/File';
import * as fs from 'fs' ;
import * as ConfigStore from 'configstore';
import {ERRORS, EVENTS} from '../constants';
import * as debug from 'debug';
import {PipListener, PipListenerConfig, PipListenerObservData} from "../tools/PipListener";

const pkg = require('../../../package.json');
const MASK = '0777';
const IGNORED_MKDIR_ERROR = 'EEXIST';
const FILE_DOESNT_EXIST = 'ENOENT';
const log = debug('tus-node-server:stores:filestore');

export type FileStoreOptType = { directory?: string, pipListenerConfig?: PipListenerConfig } & DataStoreOptType;

/**
 * @fileOverview
 * Store using local filesystem.
 *
 * @author Ben Stahl <bhstahl@gmail.com>
 */
export class FileStore extends DataStore {
    directory;
    configStore: ConfigStore;
    file;
    pipListenerConfig?: PipListenerConfig;

    constructor(options: FileStoreOptType) {
        super(options);

        this.directory = options.directory || options.path.replace(/^\//, '');
        this.pipListenerConfig = options.pipListenerConfig;

        this.extensions = ['creation', 'creation-defer-length'];
        this.configStore = new ConfigStore(`${pkg.name}-${pkg.version}`);
        this._checkOrCreateDirectory();
        this.file = {
            size: {
                bytes: 0,
                chunks: 0,
            },
        };
    }

    /**
     *  Ensure the directory exists.
     */
    _checkOrCreateDirectory() {
        fs.mkdir(this.directory, MASK, (error) => {
            if (error && error.code !== IGNORED_MKDIR_ERROR) {
                throw error;
            }
        });
    }

    /**
     * Create an empty file.
     *
     * @param  {object} req http.incomingMessage
     * @param  {File} file
     * @return {Promise}
     */
    async create(req): Promise<File> {
        const upload_length = req.headers['upload-length'];
        const upload_defer_length = req.headers['upload-defer-length'];
        const upload_metadata = req.headers['upload-metadata'];

        if (upload_length === undefined && upload_defer_length === undefined) {
            return Promise.reject(ERRORS.INVALID_LENGTH);
        }

        let file_id;
        try {
            file_id = this.generateFileName(req);
        } catch (generateError) {
            log('[FileStore] create: check your namingFunction. Error', generateError);
            return Promise.reject(ERRORS.FILE_WRITE_ERROR);
        }

        const file = new File(file_id, upload_length, upload_defer_length, upload_metadata);

        const fh = await fs.promises.open(`${this.directory}/${file.id}`, 'w')

        try {
            this.configStore.set(file.id, file);

            await fh.close();

            this.emit(EVENTS.EVENT_FILE_CREATED, {file});
            return Promise.resolve(file);
        } catch (err) {
            log('[FileStore] create: Error', err);
            return Promise.reject(err);
        }
    }

    /**
     * Write to the file, starting at the provided offset
     *
     * @param  {object} req http.incomingMessage
     * @param  {string} file_id   Name of file
     * @param  {integer} offset     starting offset
     * @return {Promise}
     */
    async write(req, file_id: string, offset: number): Promise<number> {
        return new Promise((resolve, reject) => {
            const path = `${this.directory}/${file_id}`;
            const options = {
                flags: 'r+',
                start: offset,
            };

            const stream = fs.createWriteStream(path, options);

            let new_offset = 0;
            req.on('data', (buffer) => {
                new_offset += buffer.length;
            });

            stream.on('error', (e) => {
                log('[FileStore] write: Error', e);
                reject(ERRORS.FILE_WRITE_ERROR);
            });

            const config = this.configStore.get(file_id);
            this.file.size = {
                bytes: this.file.size.bytes || parseInt(config.upload_length, 10),
                chunks: this.file.size.chunks || Math.ceil(parseInt(config.upload_length, 10) / offset),
            };
            const pl = new PipListener(this.file.size.bytes, offset, this.pipListenerConfig);
            pl.asObservable().subscribe((event: PipListenerObservData) => {
                const config = this.configStore.get(file_id);
                this.file.size = {
                    bytes: this.file.size.bytes || parseInt(config.upload_length, 10),
                    chunks: this.file.size.chunks || Math.ceil(parseInt(config.upload_length, 10) / offset),
                };
                const uploadCompleted = parseInt(config.upload_length, 10) === offset;
                this.emit(EVENTS.EVENT_CHUNK_UPLOADED, {
                    file: config,
                    // loaded: {
                    //     bytes: offset,
                    //     chunks: uploadCompleted ? this.file.size.chunks : offset / new_offset,
                    // },
                    progress: event,
                    total: this.file.size,
                });
            });

            return req
                .pipe(pl)
                .pipe(stream)
                .on('finish', () => {
                    log(`[FileStore] write: ${new_offset} bytes written to ${path}`);
                    offset += new_offset;
                    log(`[FileStore] write: File is now ${offset} bytes`);

                    const config = this.configStore.get(file_id);

                    this.file.size = {
                        bytes: this.file.size.bytes || parseInt(config.upload_length, 10),
                        chunks: this.file.size.chunks || Math.ceil(parseInt(config.upload_length, 10) / offset),
                    };

                    const uploadCompleted = parseInt(config.upload_length, 10) === offset;
                    this.emit(EVENTS.EVENT_CHUNK_UPLOADED, {
                        file: config,
                        loaded: {
                            bytes: offset,
                            chunks: uploadCompleted ? this.file.size.chunks : offset / new_offset,
                        },
                        total: this.file.size,
                    });
                    if (config && uploadCompleted) {
                        this.emit(EVENTS.EVENT_UPLOAD_COMPLETE, {file: config});
                    }
                    resolve(offset);
                });
        });
    }

    /**
     * Return file stats, if they exits
     *
     * @param  {string} file_id name of the file
     * @return {object}           fs stats
     */
    async getOffset(file_id): Promise<{ [key: string]: number }> {
        const config = this.configStore.get(file_id);
        const file_path = `${this.directory}/${file_id}`;

        return (new Promise((resolve, reject) => {
            fs.stat(file_path, (error, stats: fs.Stats) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(stats);
            });
        })).then((stats: fs.Stats) => {
            if (stats.isDirectory()) {
                log(`[FileStore] getOffset: ${file_path} is a directory`);
                return Promise.reject(ERRORS.FILE_NOT_FOUND);
            }

            const data = Object.assign(stats, config);
            return Promise.resolve(data);
        }).catch((error) => {
            if (error && error.code === FILE_DOESNT_EXIST && config) {
                log(`[FileStore] getOffset: No file found at ${file_path} but db record exists`, config);
                return Promise.reject(ERRORS.FILE_NO_LONGER_EXISTS);
            }

            if (error && error.code === FILE_DOESNT_EXIST) {
                log(`[FileStore] getOffset: No file found at ${file_path}`);
                return Promise.reject(ERRORS.FILE_NOT_FOUND);
            }

            if (error) {
                return Promise.reject(error);
            }
        });
    }
}
