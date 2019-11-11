import {ServerResponse, OutgoingHttpHeaders, IncomingHttpHeaders, IncomingMessage} from 'http';
import {BaseHandler} from './BaseHandler';
import {ERRORS} from '../constants';
import * as debug from 'debug';

const log = debug('tus-node-server:handlers:patch');

export class PatchHandler extends BaseHandler {
    /**
     * Write data to the DataStore and return the new offset.
     *
     * @param  {object} req http.incomingMessage
     * @param  {object} res http.ServerResponse
     * @return {function}
     */
    send(req, res) {
        const file_id = this.getFileIdFromRequest(req);
        if (file_id === undefined) {
            return super.send(req, res, ERRORS.FILE_NOT_FOUND.status_code, {}, ERRORS.FILE_NOT_FOUND.body);
        }

        // The request MUST include a Upload-Offset header
        let offset = req.headers['upload-offset'];
        if (offset === undefined) {
            return super.send(req, res, ERRORS.MISSING_OFFSET.status_code, {}, ERRORS.MISSING_OFFSET.body);
        }

        // The request MUST include a Content-Type header
        const content_type = req.headers['content-type'];
        if (content_type === undefined) {
            return super.send(req, res, ERRORS.INVALID_CONTENT_TYPE.status_code, {}, ERRORS.INVALID_CONTENT_TYPE.body);
        }

        offset = parseInt(offset, 10);

        return this.store.getOffset(file_id)
            .then((stats) => {
                if (stats.size !== offset) {
                    // If the offsets do not match, the Server MUST respond with the 409 Conflict status without modifying the upload resource.
                    log(`[PatchHandler] send: Incorrect offset - ${offset} sent but file is ${stats.size}`);
                    return Promise.reject(ERRORS.INVALID_OFFSET);
                }

                return this.store.write(req, file_id, offset);
            })
            .then((new_offset) => {
                //  It MUST include the Upload-Offset header containing the new offset.
                const headers: OutgoingHttpHeaders = {
                    'Upload-Offset': new_offset,
                };
                // The Server MUST acknowledge successful PATCH requests with the 204
                return super.send(req, res, 204, headers);
            })
            .catch((error) => {
                log('[PatchHandler]', error);
                const status_code = error.status_code || ERRORS.UNKNOWN_ERROR.status_code;
                const body = error.body || `${ERRORS.UNKNOWN_ERROR.body}${error.message || ''}\n`;
                return super.send(req, res, status_code, {}, body);
            });
    }
}
