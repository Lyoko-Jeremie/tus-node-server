/**
 * @fileOverview
 * Generate and random UID.
 *
 * @author Ben Stahl <bhstahl@gmail.com>
 */

import * as crypto from 'crypto' ;

export class Uid {
    static rand() {
        return crypto.randomBytes(16).toString('hex');
    }
}
