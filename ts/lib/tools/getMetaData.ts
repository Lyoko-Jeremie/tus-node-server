import {IncomingHttpHeaders, IncomingMessage} from 'http';
import {Base64} from 'js-base64';
import {isString} from 'lodash';

export function getMetaData(req: IncomingHttpHeaders & IncomingMessage): Map<string, string | undefined | any> {

    const kp: Map<string, any> = getMetaDataNotDecode(req);

    return decodeMetaData(kp);
}

export function getMetaDataNotDecode(req: IncomingHttpHeaders & IncomingMessage): Map<string, string | undefined> {
    const value = req.headers['upload-metadata'] as string;

    if (isString(value)) {
        return splitMetaData(value);
    }
    return new Map<string, string | undefined>();
}

export function decodeMetaData(kp: Map<string, string | undefined | any>): Map<string, string | undefined> {
    kp.forEach((v, k) => {
        if (isString(v)) {
            if (v.length > 0) {
                kp.set(k, Base64.decode(v));
            }
        }
    });
    return kp;
}

export function splitMetaData(metadata: string): Map<string, string | undefined> {
    const kp = new Map<string, string | undefined>();
    const keyPairs = metadata.split(',')
        .map((kp) => kp.trim().split(' '));
    keyPairs.forEach(T => {
        kp.set(T[0], T.length > 1 ? T[1] : undefined);
    });
    return kp;
}
