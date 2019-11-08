export const REQUEST_METHODS = [
    'POST',
    'HEAD',
    'PATCH',
    'OPTIONS',
];

export const HEADERS = [
    'Authorization',
    'Content-Type',
    'Location',
    'Tus-Extension',
    'Tus-Max-Size',
    'Tus-Resumable',
    'Tus-Version',
    'Upload-Defer-Length',
    'Upload-Length',
    'Upload-Metadata',
    'Upload-Offset',
    'X-HTTP-Method-Override',
    'X-Requested-With',
];

export const HEADERS_LOWERCASE = HEADERS.map((header) => header.toLowerCase());

export const ERRORS = {
    MISSING_OFFSET: {
        status_code: 403,
        body: 'Upload-Offset header required\n',
    },
    INVALID_CONTENT_TYPE: {
        status_code: 403,
        body: 'Content-Type header required\n',
    },
    FILE_NOT_FOUND: {
        status_code: 404,
        body: 'The file for this url was not found\n',
    },
    INVALID_OFFSET: {
        status_code: 409,
        body: 'Upload-Offset conflict\n',
    },
    FILE_NO_LONGER_EXISTS: {
        status_code: 410,
        body: 'The file for this url no longer exists\n',
    },
    INVALID_LENGTH: {
        status_code: 412,
        body: 'Upload-Length or Upload-Defer-Length header required\n',
    },
    UNKNOWN_ERROR: {
        status_code: 500,
        body: 'Something went wrong with that request\n',
    },
    FILE_WRITE_ERROR: {
        status_code: 500,
        body: 'Something went wrong receiving the file\n',
    },
};

export const EVENT_ENDPOINT_CREATED = 'EVENT_ENDPOINT_CREATED';
export const EVENT_FILE_CREATED = 'EVENT_FILE_CREATED';
export const EVENT_CHUNK_UPLOADED = 'EVENT_CHUNK_UPLOADED';
export const EVENT_UPLOAD_COMPLETE = 'EVENT_UPLOAD_COMPLETE';

export const EVENTS = {
    EVENT_ENDPOINT_CREATED,
    EVENT_FILE_CREATED,
    EVENT_UPLOAD_COMPLETE,
    EVENT_CHUNK_UPLOADED,
};


export const ALLOWED_HEADERS = HEADERS.join(', ');
export const ALLOWED_METHODS = REQUEST_METHODS.join(', ');
export const EXPOSED_HEADERS = HEADERS.join(', ');
export const MAX_AGE = 86400;
export const TUS_RESUMABLE = '1.0.0';
export const TUS_VERSION = ['1.0.0'];

