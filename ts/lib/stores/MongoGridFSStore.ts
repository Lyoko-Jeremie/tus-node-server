import {DataStore, DataStoreOptType} from './DataStore';
import {File} from '../models/File';
import * as mongodb from 'mongodb';
import {MongoClient, Db} from 'mongodb';
import * as SparkMD5 from 'spark-md5';
import {ERRORS, EVENTS, TUS_RESUMABLE} from '../constants';
import {PipListener, PipListenerConfig, PipListenerObservData} from '../tools/PipListener';
import {SizeChunker} from '../tools/SizeChunker';
import * as debug from 'debug';

const log = debug('tus-node-server:stores:MongoGridFSStore');

export type MongoGridFSStoreOptType =
    { uri: string, db: string, bucket: string, chunk_size?: number, pipListenerConfig?: PipListenerConfig }
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
        return new Promise((resolve, reject) => {
            this.db.then((db) => {
                const upload_length = req.headers['upload-length'];
                const upload_defer_length = req.headers['upload-defer-length'];
                const upload_metadata = req.headers['upload-metadata'];

                if (upload_length === undefined && upload_defer_length === undefined) {
                    reject(ERRORS.INVALID_LENGTH);
                    return;
                }

                const file_id = new mongodb.ObjectID();

                const file = new File(file_id.toString(), upload_length, upload_defer_length, upload_metadata);

                const md5 = new SparkMD5();

                const grid_file = {
                    _id: file_id,
                    length: 0,
                    chunkSize: this.chunk_size,
                    uploadDate: new Date(),
                    filename: 'file_' + file_id.toString(),
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

                const files = db.collection(`${this.bucket_name}.files`);
                files.insertOne(grid_file).then((result) => {
                    this.emit(EVENTS.EVENT_FILE_CREATED, {file});
                    return resolve(file);
                }).catch((err) => {
                    return reject(err);
                });
            });
        });
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
        return new Promise((resolve, reject) => {
            this.db.then((db) => {
                const chunks = db.collection(`${this.bucket_name}.chunks`);
                const files = db.collection(`${this.bucket_name}.files`);

                files.findOne({_id: new mongodb.ObjectID(file_id)}).then((fileData) => {
                    if (!fileData) {
                        return reject(ERRORS.FILE_NOT_FOUND);
                    }

                    // prepare progress
                    const fileInfo: File = fileData.metadata.fileInfo;
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
                    startingChunkPromise.then((startingChunk) => {
                        // const chunker = new chunkingStreams.SizeChunker({
                        //     chunkSize: this.chunk_size,
                        //     flushTail: true,
                        // });
                        const chunker = new SizeChunker({
                            chunkSize: this.chunk_size,
                            flushTail: true,
                        });

                        let buffer = new Buffer(0);
                        chunker.on('chunkStart', (id, callback) => {
                            buffer = new Buffer(0);
                            return callback();
                        });

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
                            reject(ERRORS.FILE_WRITE_ERROR);
                        });
                    }).catch((error) => {
                        log(`write find file Chunk error: ${JSON.stringify(error)}`);
                        console.error('[MongoGridFSStore] write', error);
                        return reject(ERRORS.FILE_WRITE_ERROR);
                    });
                }).catch((error) => {
                    log(`write find file info error: ${JSON.stringify(error)}`);
                    console.error('[MongoGridFSStore] write', error);
                    return reject(ERRORS.FILE_WRITE_ERROR);
                });
            }).catch((error) => {
                log(`write db error: ${JSON.stringify(error)}`);
                console.error('[MongoGridFSStore] write', error);
                return reject(ERRORS.FILE_WRITE_ERROR);
            });
        });
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
