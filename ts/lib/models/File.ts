'use strict';

/**
 * @fileOverview
 * Model for File objects.
 *
 * @author Ben Stahl <bhstahl@gmail.com>
 */
export class File {
    public id;

    constructor(
        file_id,
        public upload_length,
        public upload_defer_length,
        public upload_metadata
    ) {
        if (!file_id) {
            throw new Error('[File] constructor must be given a file_id');
        }

        if (upload_length === undefined && upload_defer_length === undefined) {
            throw new Error('[File] constructor must be given either a upload_length or upload_defer_length');
        }

        this.id = `${file_id}`;
    }
}

