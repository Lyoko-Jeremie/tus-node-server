import {ServerResponse, OutgoingHttpHeaders, IncomingHttpHeaders, IncomingMessage} from 'http'
import {BaseHandler} from './BaseHandler' ;
import {ERRORS, EVENT_ENDPOINT_CREATED} from '../constants' ;
import debug from 'debug' ;

const log = debug('tus-node-server:handlers:post');

export class PostHandler extends BaseHandler {
    /**
     * Create a file in the DataStore.
     *
     * @param  {object} req http.incomingMessage
     * @param  {object} res http.ServerResponse
     * @return {function}
     */
    send(req, res) {
        return this.store.create(req)
            .then((File) => {
                const url = this.store.relativeLocation ? `${req.baseUrl || ''}${this.store.path}/${File.id}` : `//${req.headers.host}${req.baseUrl || ''}${this.store.path}/${File.id}`;

                this.emit(EVENT_ENDPOINT_CREATED, {url});
                return super.send(req, res, 201, {Location: url});
            })
            .catch((error) => {
                log('[PostHandler]', error);
                const status_code = error.status_code || ERRORS.UNKNOWN_ERROR.status_code;
                const body = error.body || `${ERRORS.UNKNOWN_ERROR.body}${error.message || ''}\n`;
                return super.send(req, res, status_code, {}, body);
            });
    }
}
