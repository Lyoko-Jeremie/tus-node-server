import {ServerResponse, OutgoingHttpHeaders, IncomingHttpHeaders, IncomingMessage} from 'http';
import {DataStore} from '../stores/DataStore';
import {EventEmitter} from 'events';
import * as debug from 'debug' ;

const log = debug('tus-node-server:handlers:base');

export class BaseHandler extends EventEmitter {
    store: DataStore;

    constructor(store) {
        super();
        if (!(store instanceof DataStore)) {
            throw new Error(`${store} is not a DataStore`);
        }
        this.store = store;
    }

    /**
     * Wrapper on http.ServerResponse.
     *
     * @param  {IncomingHttpHeaders & IncomingMessage} req
     * @param  {object} res http.ServerResponse
     * @param  {integer} status
     * @param  {object} headers
     * @param  {string} body
     * @return {ServerResponse}
     */
    send(req: IncomingHttpHeaders & IncomingMessage, res: ServerResponse, status: number, headers?: OutgoingHttpHeaders, body?: string): Promise<ServerResponse> {
        headers = headers ? headers : {};
        body = body ? body : '';
        headers = Object.assign(headers, {
            'Content-Length': body.length,
        });

        log(`status:${status}`);
        log(`headers:${JSON.stringify(headers)}`);

        res.writeHead(status, headers);
        res.write(body);

        log(`headers send:${JSON.stringify(res.getHeaders())}`);

        // return res.end();
        res.end();
        return Promise.resolve(res);
    }

    /**
     * Extract the file id from the request
     *
     * @param  {object} req http.incomingMessage
     * @return {boolean|string}
     */
    getFileIdFromRequest(req: IncomingHttpHeaders & IncomingMessage): undefined | string {
        const re = new RegExp(`${req.baseUrl || ''}${this.store.path}\\/(\\S+)\\/?`); // eslint-disable-line prefer-template
        let url = (req.originalUrl || req.url);
        if (url instanceof Array) {
            url = url.join();
        }
        const match = url.match(re);
        if (!match) {
            return undefined;
        }

        const file_id = match[1];
        return file_id;
    }

}

