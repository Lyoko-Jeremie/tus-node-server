import {IncomingHttpHeaders, IncomingMessage, ServerResponse} from 'http';
import * as debug from 'debug';

const log = debug('tus-node-server:BaseFilter');

export type FilterFunc = (req: IncomingHttpHeaders & IncomingMessage, res: ServerResponse) => Promise<boolean>;

export class BaseFilter {
    /**
     * filter all request
     * @param req
     * @param res
     * @return boolean   if true, allow,  otherwise deny
     */
    public all: FilterFunc = async (req: IncomingHttpHeaders & IncomingMessage, res: ServerResponse) => {
        log('all filter');
        return true;
    };

    public options = async (req: IncomingHttpHeaders & IncomingMessage, res: ServerResponse) => {
        log('options filter');
        return true;
    };

    public patch: FilterFunc = async (req: IncomingHttpHeaders & IncomingMessage, res: ServerResponse) => {
        log('patch filter');
        return true;
    };

    public post: FilterFunc = async (req: IncomingHttpHeaders & IncomingMessage, res: ServerResponse) => {
        log('post filter');
        return true;
    };

    public head: FilterFunc = async (req: IncomingHttpHeaders & IncomingMessage, res: ServerResponse) => {
        log('head filter');
        return true;
    };

    public get: FilterFunc = async (req: IncomingHttpHeaders & IncomingMessage, res: ServerResponse) => {
        log('get filter');
        return true;
    };
}
