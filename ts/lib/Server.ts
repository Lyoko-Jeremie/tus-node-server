/**
 * @fileOverview
 * TUS Protocol Server Implementation.
 *
 * @author Ben Stahl <bhstahl@gmail.com>
 */
import * as http from 'http';
import {EventEmitter} from 'events';

import {DataStore} from './stores/DataStore';
import {HeadHandler} from './handlers/HeadHandler';
import {OptionsHandler} from './handlers/OptionsHandler';
import {PatchHandler} from './handlers/PatchHandler';
import {PostHandler} from './handlers/PostHandler';
import {RequestValidator} from './validators/RequestValidator';
import {ERRORS, EXPOSED_HEADERS, REQUEST_METHODS, TUS_RESUMABLE} from './constants';
import * as debug from 'debug';
import {IncomingHttpHeaders, IncomingMessage, ServerResponse} from 'http';
import {BaseFilter} from './filter/BaseFilter';

const log = debug('tus-node-server');

export interface TusServerOpt {
    /**
     * if true, disable the builtin CORS control function,
     * in this case, you MUST need set the CORS correctly by yourself.
     *
     * you must set the "Access-Control-Expose-Headers" as ```constants.EXPOSED_HEADERS``` ,
     * otherwise the Tus protocol will not work.
     *
     * recommend use the (expressjs/cors)[https://github.com/expressjs/cors] package to set it if you use express.
     *
     * REMEMBER !!! DONT FORGOT TO SET THE "Access-Control-Expose-Headers" or "exposedHeaders" on cors .
     *
     */
    disableBuiltinCors?: boolean;
}

export class TusServer extends EventEmitter {

    handlers: {
        // GET handlers should be written in the implementations
        // eg.
        //      const server = new tus.Server();
        //      server.get('/', (req, res) => { ... });
        GET: {},
        // These methods are handled under the tus protocol
        HEAD: HeadHandler,
        OPTIONS: OptionsHandler,
        PATCH: PatchHandler,
        POST: PostHandler,
    };
    _datastore: DataStore;
    public filter: BaseFilter;
    options: TusServerOpt;

    constructor(options?: TusServerOpt) {
        super();

        // Any handlers assigned to this object with the method as the key
        // will be used to repond to those requests. They get set/re-set
        // when a datastore is assigned to the server.
        this.handlers = {} as any;

        this.filter = new BaseFilter();

        this.options = options || {};

        // Remove any event listeners from each handler as they are removed
        // from the server. This must come before adding a 'newListener' listener,
        // to not add a 'removeListener' event listener to all request handlers.
        this.on('removeListener', (event, listener) => {
            this.datastore.removeListener(event, listener);
            REQUEST_METHODS.forEach((method) => {
                this.handlers[method].removeListener(event, listener);
            });
        });

        // As event listeners are added to the server, make sure they are
        // bubbled up from request handlers to fire on the server level.
        this.on('newListener', (event, listener) => {
            this.datastore.on(event, listener);
            REQUEST_METHODS.forEach((method) => {
                this.handlers[method].on(event, listener);
            });
        });
    }

    /**
     * Return the data store
     * @return {DataStore}
     */
    get datastore() {
        return this._datastore;
    }

    /**
     * Assign a datastore to this server, and re-set the handlers to use that
     * data store when doing file operations.
     *
     * @param  {DataStore} store Store for uploaded files
     */
    set datastore(store) {
        if (!(store instanceof DataStore)) {
            throw new Error(`${store} is not a DataStore`);
        }

        this._datastore = store;

        this.handlers = {
            // GET handlers should be written in the implementations
            // eg.
            //      const server = new tus.Server();
            //      server.get('/', (req, res) => { ... });
            GET: {},

            // These methods are handled under the tus protocol
            HEAD: new HeadHandler(store),
            OPTIONS: new OptionsHandler(store),
            PATCH: new PatchHandler(store),
            POST: new PostHandler(store),
        };
    }


    /**
     * Allow the implementation to handle GET requests, in an
     * express.js style manor.
     *
     * @param  {String}   path     Path for the GET request
     * @param  {Function} callback Request listener
     */
    get(path, callback) {

        // Add this handler callback to the GET method handler list.
        this.handlers.GET[path] = callback;
    }

    protected async _checkFilter(op: 'all' | 'get' | 'patch' | 'post' | 'head' | 'options' | string, req: IncomingHttpHeaders & IncomingMessage, res: ServerResponse) {
        op = op.toLowerCase();
        if (['all', 'get', 'patch', 'post', 'head', 'options'].find(T => T === op)) {
            if (!await this.filter[op](req, res).catch(E => {
                log(`[TusServer] handle "${op}" filter error: ${E}`);
                console.error(`[TusServer] handle "${op}" filter error:`, E);

                // res can write, res is not end()
                // set error message to end it
                if (!res.finished) {
                    const status_code = E.status_code || ERRORS.FILTER_REJECT_ERROR.status_code;
                    const body = E.body || `${ERRORS.FILTER_REJECT_ERROR.body} : ${E.message || ''}\n`;
                    res.writeHead(status_code, {});
                    res.write(body);
                    res.end();
                }

                return false;
            })) {
                log(`[TusServer] handle "${op}" filter deny on: ${req.method} ${req.url} ,headers: ${JSON.stringify(req.headers)}`);
                res.end();
                return false;
            }
        }
        return true;
    }

    /**
     * Main server requestListener, invoked on every 'request' event.
     *
     * @param  {object} req http.incomingMessage
     * @param  {object} res http.ServerResponse
     * @param next nextFunction, work for express and promise
     * @return {ServerResponse}
     */
    handle(req: IncomingHttpHeaders & IncomingMessage, res: ServerResponse, next?: ((err?: any) => void)): Promise<ServerResponse | void> {
        return this._handle(req, res).then(T => {
            // not need to call next , because this are processed
            // next();
            return T;
        }).catch(E => {
            next(E);
            // return Promise.reject(E);
        });
    }

    async _handle(req: IncomingHttpHeaders & IncomingMessage, res: ServerResponse): Promise<ServerResponse> {
        log(`[TusServer] handle: ${req.method} ${req.url} ,headers: ${JSON.stringify(req.headers)}`);

        // Allow overriding the HTTP method. The reason for this is
        // that some libraries/environments to not support PATCH and
        // DELETE requests, e.g. Flash in a browser and parts of Java
        if (req.headers['x-http-method-override'] && req.headers['x-http-method-override'] instanceof String) {
            req.method = (req.headers['x-http-method-override'] as string).toUpperCase();
        }

        if (!await this._checkFilter('all', req, res)) {
            return res;
        }

        if (req.method === 'GET') {

            if (!await this._checkFilter('get', req, res)) {
                return res;
            }

            // Check if this url has been added to allow GET requests, with an
            // appropriate callback to handle the request
            if (!(req.url in this.handlers.GET)) {
                res.writeHead(404, {});
                res.write('Not found\n');
                res.end();
                return res;
            }

            // invoke the callback
            return this.handlers.GET[req.url](req, res);
        }

        // The Tus-Resumable header MUST be included in every request and
        // response except for OPTIONS requests. The value MUST be the version
        // of the protocol used by the Client or the Server.
        res.setHeader('Tus-Resumable', TUS_RESUMABLE);
        if (req.method !== 'OPTIONS' && req.headers['tus-resumable'] === undefined) {
            res.writeHead(412, 'Precondition Failed');
            res.end('Tus-Resumable Required\n');
            return res;
        }

        // Validate all required headers to adhere to the tus protocol
        const invalid_headers = [];
        for (const header_name in req.headers) {
            if (req.method === 'OPTIONS') {
                continue;
            }

            // Content type is only checked for PATCH requests. For all other
            // request methods it will be ignored and treated as no content type
            // was set because some HTTP clients may enforce a default value for
            // this header.
            // See https://github.com/tus/tus-node-server/pull/116
            if (header_name.toLowerCase() === 'content-type' && req.method !== 'PATCH') {
                continue;
            }
            if (RequestValidator.isInvalidHeader(header_name, req.headers[header_name])) {
                log(`Invalid ${header_name} header: ${req.headers[header_name]}`);
                invalid_headers.push(header_name);
            }
        }

        if (invalid_headers.length > 0) {
            // The request was not configured to the tus protocol
            res.writeHead(412, 'Precondition Failed');
            res.end(`Invalid ${invalid_headers.join(' ')}\n`);
            return res;
        }

        if (!this.options.disableBuiltinCors) {
            // Enable CORS by default
            res.setHeader('Access-Control-Expose-Headers', EXPOSED_HEADERS);
            if (req.headers.origin) {
                res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
            }
        }

        // Invoke the handler for the method requested
        if (this.handlers[req.method]) {

            if (!await this._checkFilter(req.method, req, res)) {
                return res;
            }

            return this.handlers[req.method].send(req, res);
        }

        // 404 Anything else
        res.writeHead(404, {});
        res.write('Not found\n');
        res.end();
        return res;
    }

    listen() {
        const server = http.createServer(this.handle.bind(this));
        return server.listen.apply(server, arguments);
    }
}
