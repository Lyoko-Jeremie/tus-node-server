import {DataStore, DataStoreOptType} from './DataStore';
import {File} from '../models/File';
import * as mongodb from 'mongodb';
import {Db, MongoClient} from 'mongodb';
import * as SparkMD5 from 'spark-md5';
import {ERRORS, EVENTS, TUS_RESUMABLE} from '../constants';
import {PipListener, PipListenerConfig, PipListenerObservData} from '../tools/PipListener';
import {SizeChunker} from '../tools/SizeChunker';
import * as debug from 'debug';
import {IncomingHttpHeaders, IncomingMessage} from 'http';

const log = debug('tus-node-server:stores:MongoGridFSStore');

export interface GridFileTypeMetadata {
    upload_length?: number | string;
    tus_version: string;
    upload_metadata: string;
    upload_defer_length?: number | string;
    md5state?: any;
    fileInfo: File;
}

export interface GridFileType {
    _id: mongodb.ObjectId;
    length: number;
    chunkSize: number;
    uploadDate: Date;
    filename: string;
    md5: string;
    metadata: GridFileTypeMetadata & { [key: string]: any };
}

export interface MongoGridFSFilter {
    beforeCreate?: ((req: IncomingHttpHeaders & IncomingMessage, file: File, grid_file: GridFileType) => Promise<boolean>);
    afterCreate?: ((req: IncomingHttpHeaders & IncomingMessage, file: File, grid_file: GridFileType, result: mongodb.InsertOneWriteOpResult<GridFileType>) => Promise<any>);
    beforeWrite?: ((req: IncomingHttpHeaders & IncomingMessage, file: File, grid_file: GridFileType) => Promise<boolean>);
    afterWrite?: ((req: IncomingHttpHeaders & IncomingMessage, file: File, grid_file: GridFileType) => Promise<any>);
}

export type MongoGridFSStoreOptType =
    { uri: string, db: string, bucket: string, chunk_size?: number, pipListenerConfig?: PipListenerConfig, filter?: MongoGridFSFilter }
    & DataStoreOptType;

/**
 * @fileOverview
 * A Store that is backed by a MongoDB, using its GridFS feature.
 *
 * See https://docs.mongodb.com/manual/core/gridfs/ and
 * http://mongodb.github.io/node-mongodb-native/2.2/tutorials/gridfs/streaming/
 * for more information.
 *
 * @author Bradley Arsenault <brad@electricbrain.io>
 */
export class MongoGridFSStore extends DataStore {
    bucket_name: string;
    chunk_size: number;
    db: Promise<Db>;
    pipListenerConfig?: PipListenerConfig;
    filter: MongoGridFSFilter;

    /**
     * Construct the MongoGridFSStore.
     *
     * @param {object} options An object containing all of the options for the store
     * @param {string} options.uri The URI for the Mongo database. Must be in the form of mongodb://localhost/database_name
     * @param {string} options.bucket The name of the bucket to store the files in under Mongo. Mongo GridFS creates two collections from your bucket name.
     * @param {string} options.db The name of the db to store the files in under Mongo.
     * @param {number} options.chunk_size The chunk size, in bytes, for the files in MongoDB. Defaults to 64kb
     */
    constructor(options: MongoGridFSStoreOptType) {
        super(options);
        this.extensions = ['creation', 'creation-defer-length'];

        if (!options.uri) {
            throw new Error('MongoGridFSStore must be provided with the URI for the Mongo database!');
        }
        if (!options.db) {
            throw new Error('MongoGridFSStore must be provided with a db name to store the files in within Mongo!');
        }
        if (!options.bucket) {
            throw new Error('MongoGridFSStore must be provided with a bucket name to store the files in within Mongo!');
        }
        this.bucket_name = options.bucket;
        this.chunk_size = options.chunk_size || (1024 * 255);
        this.pipListenerConfig = Object.assign({
            chunkSizeCounter: (chunk: any) => {
                if (chunk && chunk.data) {
                    return (chunk.data as ArrayBuffer).byteLength;
                }
                return (chunk as ArrayBuffer).byteLength;
            },
            isObjectMode: true,
        } as PipListenerConfig, options.pipListenerConfig || {});
        this.filter = options.filter || {};

        this.db = MongoClient.connect(options.uri, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        }).then((mc: MongoClient) => {
            return mc.db(options.db);
        }).then((db) => {
            const chunks = db.collection(`${this.bucket_name}.chunks`);
            const files = db.collection(`${this.bucket_name}.files`);

            return chunks.createIndex({files_id: 1, n: 1}).then(() => {
                return db;
            });
        });
    }


    /**
     * Create an empty file in Mongo to store the metadata.
     *
     * @param  {object} req http.incomingMessage
     * @return {Promise}
     */
    async create(req): Promise<File> {
        const db = await this.db;
        const upload_length = req.headers['upload-length'];
        const upload_defer_length = req.headers['upload-defer-length'];
        const upload_metadata = req.headers['upload-metadata'];

        if (upload_length === undefined && upload_defer_length === undefined) {
            return Promise.reject(ERRORS.INVALID_LENGTH);
        }

        const file_id = new mongodb.ObjectID();

        let file_Name = undefined;
        try {
            file_Name = this.generateFileName(req);
        } catch (generateError) {
            log('[FileStore] create: check your namingFunction. Error', generateError);
            return Promise.reject(ERRORS.FILE_WRITE_ERROR);
        }

        const file = new File(file_id.toString(), upload_length, upload_defer_length, upload_metadata);

        const md5 = new SparkMD5();

        const grid_file: GridFileType = {
            _id: file_id,
            length: 0,
            chunkSize: this.chunk_size,
            uploadDate: new Date(),
            // filename: 'file_' + file_id.toString(),
            filename: 'file_' + file_Name,
            md5: md5.end(),
            metadata: {
                upload_length: file.upload_length,
                tus_version: TUS_RESUMABLE,
                upload_metadata,
                upload_defer_length,
                md5state: md5.getState(),
                fileInfo: file,
            },
        };

        if (this.filter.beforeCreate) {
            if (!await this.filter.beforeCreate(req, file, grid_file)) {
                log('write filter beforeCreate reject it.');
                return Promise.reject(ERRORS.FILTER_REJECT_ERROR);
            }
        }

        const files = db.collection<GridFileType>(`${this.bucket_name}.files`);
        try {
            const _result = await files.insertOne(grid_file);
            this.emit(EVENTS.EVENT_FILE_CREATED, {file});

            if (this.filter.afterCreate) {
                try {
                    await this.filter.afterCreate(req, file, grid_file, _result);
                } catch (e) {
                    log('write filter afterCreate reject.', {req, file, grid_file, _result, e});
                    console.warn('write filter afterCreate reject.', {req, file, grid_file, _result, e});
                }
            }

            return Promise.resolve(file);
        } catch (e) {
            return Promise.reject(e);
        }
    }

    /**
     * Get the file metadata from the object in GCS, then upload a new version
     * passing through the metadata to the new version.
     *
     * @param  {object} req         http.incomingMessage
     * @param  {string} file_id     Name of file
     * @param  {integer} offset     starting offset
     * @return {Promise}
     */
    async write(req, file_id, offset): Promise<number> {
        // Get the current file object from MongoDB
        try {
            const db = await this.db;
            const chunks = db.collection(`${this.bucket_name}.chunks`);
            const files = db.collection(`${this.bucket_name}.files`);

            const fileData = await files.findOne({_id: new mongodb.ObjectID(file_id)});
            if (!fileData) {
                return Promise.reject(ERRORS.FILE_NOT_FOUND);
            }

            if (!fileData.metadata.md5state) {
                log(`write (!fileData.metadata.md5state) .`);
                return Promise.reject(ERRORS.FILE_NOT_FOUND);
            }
            if (!fileData.metadata.fileInfo) {
                log(`write (!fileData.metadata.fileInfo) .`);
                return Promise.reject(ERRORS.FILE_NOT_FOUND);
            }

            const fileInfo: File = fileData.metadata.fileInfo;

            if (this.filter.beforeWrite) {
                if (!await this.filter.beforeWrite(req, fileInfo, fileData)) {
                    log('write filter beforeWrite reject it.');
                    return Promise.reject(ERRORS.FILTER_REJECT_ERROR);
                }
            }

            // prepare progress
            const pipListener = new PipListener(
                parseInt(fileInfo.upload_length, 10),
                offset,
                this.pipListenerConfig,
            );

            pipListener.asObservable().subscribe((event: PipListenerObservData) => {
                this.emit(EVENTS.EVENT_CHUNK_UPLOADED, {
                    file: fileInfo,
                    progress: event,
                    // total: this.file.size,
                });
            });

            // If the offset is above 0, then we fetch that chunk
            // to use as a starting point. Otherwise we create a
            // brand new chunk.
            const startingChunkIndex = Math.floor(offset / this.chunk_size);
            const startingChunkData = offset % this.chunk_size;
            let startingChunkPromise = Promise.resolve(null);
            if (offset > 0) {
                startingChunkPromise = chunks.findOne({
                    files_id: new mongodb.ObjectID(file_id),
                    n: startingChunkIndex
                });
            }

            const md5 = new SparkMD5();
            md5.setState(fileData.metadata.md5state);
            let fileSize = startingChunkIndex * this.chunk_size;
            try {
                const startingChunk = await startingChunkPromise;

                const endPromise = new Promise<number>((resolve, reject) => {

                    // use SizeChunker to split stream into many chunk
                    const chunker = new SizeChunker({
                        chunkSize: this.chunk_size,
                        flushTail: true,
                    });

                    let buffer = new Buffer(0);
                    chunker.on('chunkStart', (id, callback) => {
                        buffer = new Buffer(0);
                        return callback();
                    });

                    // on every chunk end
                    chunker.on('chunkEnd', (id, callback) => {
                        // log(`chunkEnd n:${startingChunkIndex + id}`);
                        chunks.replaceOne({
                            files_id: new mongodb.ObjectID(file_id),
                            n: startingChunkIndex + id,
                        }, {
                            files_id: new mongodb.ObjectID(file_id),
                            n: startingChunkIndex + id,
                            data: buffer,
                        }, {upsert: true}).then((result) => {
                            // log(`chunkEnd insert chunk result:${JSON.stringify(result)}`);
                            fileSize += buffer.length;
                            fileData.length = fileSize;
                            fileData.md5 = md5.end();
                            fileData.metadata.md5state = md5.getState();
                            files.replaceOne({
                                _id: new mongodb.ObjectID(file_id),
                            }, fileData).then((result) => {
                                // log(`chunkEnd update fileData result:${JSON.stringify(result)}`);
                                return callback(null, result);
                            }).catch((err) => {
                                log(`chunkEnd update fileData error:${err}`);
                                console.error('chunkEnd update fileData error', err);
                                return callback(err);
                            });
                        }).catch((err) => {
                            log(`chunkEnd insert chunk error:${err}`);
                            console.error('chunkEnd insert chunk error', err);
                            return callback(err);
                        });
                    });

                    chunker.pipe(pipListener).on('data', (chunk) => {
                        buffer = Buffer.concat([buffer, chunk.data]);
                    }).on('end', () => {
                        log(`chunker end.~~`);

                        // check the file is all complete and send the complete event
                        if (parseInt(fileData.metadata.upload_length, 10) === new_offset) {
                            this.emit(EVENTS.EVENT_UPLOAD_COMPLETE, {file: fileData});
                        }

                        if (this.filter.afterWrite) {
                            this.filter.afterWrite(req, fileInfo, fileData).catch(E => {
                                log(`write filter afterWrite reject :`, E);
                                console.warn('write filter afterWrite reject', E);
                            });
                        }
                    });

                    req.on('end', () => {

                        chunker.end((err) => {
                            if (err) {
                                return reject(err);
                            }

                            return resolve(new_offset);
                        });
                    });

                    chunker.on('error', (error) => {
                        log(`write chunker error: ${JSON.stringify(error)}`);
                        console.error(error);
                        return reject(ERRORS.FILE_WRITE_ERROR);
                    });

                    // If there is a starting chunk, write all of its data to the chunker
                    if (startingChunk) {
                        chunker.write(startingChunk.data.buffer.slice(0, startingChunkData));
                    }

                    let new_offset = offset;
                    req.on('data', (buffer) => {
                        new_offset += buffer.length;
                        md5.append(buffer);
                        chunker.write(buffer);
                    });

                });

                return await endPromise;

            } catch (error) {
                log(`write find file Chunk error: ${JSON.stringify(error)}`);
                console.error('[MongoGridFSStore] write', error);
                return Promise.reject(ERRORS.FILE_WRITE_ERROR);
            }
        } catch (error) {
            log(`write db error: ${JSON.stringify(error)}`);
            console.error('[MongoGridFSStore] write', error);
            return Promise.reject(ERRORS.FILE_WRITE_ERROR);
        }
    }

    /**
     * Get file metadata from the object in MongoDB
     *
     * @param  {string} file_id     name of the file
     * @return {object}
     */
    async getOffset(file_id): Promise<{ [key: string]: number }> {
        return new Promise((resolve, reject) => {
            this.db.then((db) => {
                let _id;
                try {
                    _id = new mongodb.ObjectID(file_id);
                } catch (err) {
                    reject(err);
                }

                const files = db.collection(`${this.bucket_name}.files`);
                files.findOne({_id}).then((fileData) => {
                    if (!fileData) {
                        return reject(ERRORS.FILE_NOT_FOUND);
                    }

                    if (!fileData.metadata.md5state) {
                        log(`getOffset (!fileData.metadata.md5state) .`);
                        return reject(ERRORS.FILE_NOT_FOUND);
                    }
                    if (!fileData.metadata.fileInfo) {
                        log(`getOffset (!fileData.metadata.fileInfo) .`);
                        return reject(ERRORS.FILE_NOT_FOUND);
                    }


                    const data: { [key: string]: number } = {
                        size: fileData.length,
                    };

                    if (!('metadata' in fileData)) {
                        return resolve(data);
                    }

                    if (fileData.metadata.upload_length) {
                        data.upload_length = fileData.metadata.upload_length;
                    }

                    if (fileData.metadata.upload_defer_length) {
                        data.upload_defer_length = fileData.metadata.upload_defer_length;
                    }

                    if (fileData.metadata.upload_metadata) {
                        data.upload_metadata = fileData.metadata.upload_metadata;
                    }

                    return resolve(data);
                }).catch((error) => {
                    console.error('[MongoGridFSStore] getFileMetadata', error);
                    return reject(error);
                });
            });
        });
    }
}
