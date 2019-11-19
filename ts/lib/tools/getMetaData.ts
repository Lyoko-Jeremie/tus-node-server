import {IncomingHttpHeaders, IncomingMessage} from 'http';
import {Base64} from 'js-base64';
import {isString} from 'lodash';

export function getMetaData(req: IncomingHttpHeaders & IncomingMessage): Map<string, string | undefined | any> {

    const kp: Map<string, any> = getMetaDataNotDecode(req);

    kp.forEach((v, k) => {
        if (isString(v)) {
            if (v.length > 0) {
                kp.set(k, Base64.decode(v));
            }
        }
    });

    return kp;
}

export function getMetaDataNotDecode(req: IncomingHttpHeaders & IncomingMessage): Map<string, string | undefined> {
    const value = req.headers['upload-metadata'] as string;
    const keyPairs = value.split(',')
        .map((kp) => kp.trim().split(' '));

    const kp = new Map<string, string | undefined>();
    keyPairs.forEach(T => {
        kp.set(T[0], T.length > 1 ? T[1] : undefined);
    });

    return kp;
}
