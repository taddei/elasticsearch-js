'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const debug_1 = __importDefault(require("debug"));
const os_1 = __importDefault(require("os"));
const zlib_1 = require("zlib");
const into_stream_1 = __importDefault(require("into-stream"));
const ms_1 = __importDefault(require("ms"));
const errors_1 = require("./errors");
const debug = debug_1.default('elasticsearch');
const noop = () => { };
const sniffNoop = (err, hosts) => { };
const clientVersion = require('../package.json').version;
const userAgent = `elasticsearch-js/${clientVersion} (${os_1.default.platform()} ${os_1.default.release()}-${os_1.default.arch()}; Node.js ${process.version})`;
class Transport {
    constructor(opts) {
        if (typeof opts.compression === 'string' && opts.compression !== 'gzip') {
            throw new errors_1.ConfigurationError(`Invalid compression: '${opts.compression}'`);
        }
        this.emit = opts.emit;
        this.connectionPool = opts.connectionPool;
        this.serializer = opts.serializer;
        this.maxRetries = opts.maxRetries;
        this.requestTimeout = toMs(opts.requestTimeout);
        this.suggestCompression = opts.suggestCompression === true;
        this.compression = opts.compression || false;
        this.headers = Object.assign({}, { 'User-Agent': userAgent }, opts.headers);
        this.sniffInterval = typeof opts.sniffInterval === 'number' ? opts.sniffInterval : -1;
        this.sniffOnConnectionFault = opts.sniffOnConnectionFault;
        this.sniffEndpoint = opts.sniffEndpoint;
        this.generateRequestId = opts.generateRequestId || generateRequestId();
        this.name = opts.name;
        this.nodeFilter = opts.nodeFilter || defaultNodeFilter;
        if (typeof opts.nodeSelector === 'function') {
            this.nodeSelector = opts.nodeSelector;
        }
        else if (opts.nodeSelector === 'round-robin') {
            this.nodeSelector = roundRobinSelector();
        }
        else if (opts.nodeSelector === 'random') {
            this.nodeSelector = randomSelector;
        }
        else {
            this.nodeSelector = roundRobinSelector();
        }
        this._sniffEnabled = this.sniffInterval > -1;
        this._nextSniff = this._sniffEnabled ? (Date.now() + this.sniffInterval) : 0;
        this._isSniffing = false;
        if (opts.sniffOnStart === true) {
            this.sniff({ reason: Transport.sniffReasons.SNIFF_ON_START });
        }
    }
    request(params, options, callback) {
        options = options || {};
        if (typeof options === 'function') {
            callback = options;
            options = {};
        }
        if (callback === undefined) {
            return new Promise((resolve, reject) => {
                this.request(params, options, (err, result) => {
                    err ? reject(err) : resolve(result);
                });
            });
        }
        const requestParams = {
            path: params.path,
            method: params.method,
            body: undefined,
            asStream: false,
            querystring: undefined,
            headers: {},
            timeout: undefined
        };
        const meta = {
            context: options.context || null,
            request: {
                params: requestParams,
                options: options,
                id: options.id || this.generateRequestId(params, options)
            },
            name: this.name,
            connection: null,
            attempts: 0,
            aborted: false
        };
        const result = {
            body: null,
            statusCode: null,
            headers: null,
            warnings: options.warnings || null,
            meta
        };
        const maxRetries = options.maxRetries || this.maxRetries;
        const compression = options.compression || this.compression;
        var request = { abort: noop };
        const makeRequest = () => {
            if (meta.aborted === true)
                return;
            meta.connection = this.getConnection({ requestId: meta.request.id });
            if (meta.connection === null) {
                return callback(new errors_1.NoLivingConnectionsError('There are not living connections', result), result);
            }
            const headers = Object.assign({}, this.headers, options.headers);
            if (params.body !== null && params.body !== undefined) {
                if (shouldSerialize(params.body) === true) {
                    try {
                        requestParams.body = this.serializer.serialize(params.body);
                    }
                    catch (err) {
                        return callback(err, result);
                    }
                }
                else if (params.body !== '') {
                    requestParams.body = params.body;
                }
                headers['Content-Type'] = headers['Content-Type'] || 'application/json';
                if (compression === 'gzip' && requestParams.body !== undefined) {
                    if (isStream(requestParams.body)) {
                        requestParams.body = requestParams.body.pipe(zlib_1.createGzip());
                    }
                    else {
                        requestParams.body = into_stream_1.default(requestParams.body).pipe(zlib_1.createGzip());
                    }
                    headers['Content-Encoding'] = compression;
                }
                if (requestParams.body !== undefined && !isStream(requestParams.body)) {
                    headers['Content-Length'] = '' + Buffer.byteLength(requestParams.body);
                }
            }
            else if (params.bulkBody != null) {
                if (shouldSerialize(params.bulkBody) === true) {
                    try {
                        requestParams.body = this.serializer.ndserialize(params.bulkBody);
                    }
                    catch (err) {
                        return callback(err, result);
                    }
                }
                else if (params.bulkBody !== '') {
                    requestParams.body = params.bulkBody;
                }
                headers['Content-Type'] = headers['Content-Type'] || 'application/x-ndjson';
                if (compression === 'gzip' && requestParams.body !== undefined) {
                    if (isStream(requestParams.body)) {
                        requestParams.body = requestParams.body.pipe(zlib_1.createGzip());
                    }
                    else {
                        requestParams.body = into_stream_1.default(requestParams.body).pipe(zlib_1.createGzip());
                    }
                    headers['Content-Encoding'] = compression;
                }
                if (requestParams.body !== undefined && !isStream(requestParams.body)) {
                    headers['Content-Length'] = '' + Buffer.byteLength(requestParams.body);
                }
            }
            if (this.suggestCompression === true) {
                headers['Accept-Encoding'] = 'gzip,deflate';
            }
            requestParams.headers = headers;
            if (options.querystring == null) {
                requestParams.querystring = this.serializer.qserialize(params.querystring);
            }
            else {
                requestParams.querystring = this.serializer.qserialize(Object.assign({}, params.querystring, options.querystring));
            }
            requestParams.timeout = toMs(options.requestTimeout || this.requestTimeout);
            if (options.asStream === true)
                requestParams.asStream = true;
            this.emit('request', null, result);
            return meta.connection.request(requestParams, onResponse);
        };
        const onResponse = (err, response) => {
            if (err !== null) {
                this.connectionPool.markDead(meta.connection);
                if (this.sniffOnConnectionFault === true) {
                    this.sniff({
                        reason: Transport.sniffReasons.SNIFF_ON_CONNECTION_FAULT,
                        requestId: meta.request.id
                    });
                }
                if (meta.attempts < maxRetries) {
                    meta.attempts++;
                    debug(`Retrying request, there are still ${maxRetries - meta.attempts} attempts`, params);
                    request = makeRequest();
                    return;
                }
                const error = err instanceof errors_1.TimeoutError
                    ? err
                    : new errors_1.ConnectionError(err.message, result);
                if (err.name === 'TimeoutError') {
                    err.meta = result;
                }
                this.emit('response', error, result);
                return callback(error, result);
            }
            const { statusCode, headers } = response;
            result.statusCode = statusCode;
            result.headers = headers;
            if (headers['warning'] != null) {
                result.warnings = result.warnings || [];
                result.warnings.push.apply(result.warnings, headers['warning'].split(/(?!\B"[^"]*),(?![^"]*"\B)/));
            }
            if (options.asStream === true) {
                result.body = response;
                this.emit('response', null, result);
                callback(null, result);
                return;
            }
            var payload = '';
            response.setEncoding('utf8');
            response.on('data', chunk => { payload += chunk; });
            response.on('error', err => {
                const error = new errors_1.ConnectionError(err.message, result);
                this.emit('response', error, result);
                callback(error, result);
            });
            response.on('end', () => {
                const isHead = params.method === 'HEAD';
                if (headers['content-type'] != null &&
                    headers['content-type'].indexOf('application/json') > -1 &&
                    isHead === false &&
                    payload !== '') {
                    try {
                        result.body = this.serializer.deserialize(payload);
                    }
                    catch (err) {
                        this.emit('response', err, result);
                        return callback(err, result);
                    }
                }
                else {
                    result.body = isHead === true ? true : payload;
                }
                const ignoreStatusCode = (Array.isArray(options.ignore) && options.ignore.indexOf(statusCode) > -1) ||
                    (isHead === true && statusCode === 404);
                if (ignoreStatusCode === false &&
                    (statusCode === 502 || statusCode === 503 || statusCode === 504)) {
                    this.connectionPool.markDead(meta.connection);
                    if (meta.attempts < maxRetries && statusCode !== 429) {
                        meta.attempts++;
                        debug(`Retrying request, there are still ${maxRetries - meta.attempts} attempts`, params);
                        request = makeRequest();
                        return;
                    }
                }
                else {
                    this.connectionPool.markAlive(meta.connection);
                }
                if (ignoreStatusCode === false && statusCode >= 400) {
                    const error = new errors_1.ResponseError(result);
                    this.emit('response', error, result);
                    callback(error, result);
                }
                else {
                    if (isHead === true && statusCode === 404) {
                        result.body = false;
                    }
                    this.emit('response', null, result);
                    callback(null, result);
                }
            });
        };
        request = makeRequest();
        return {
            abort: () => {
                meta.aborted = true;
                request.abort();
                debug('Aborting request', params);
            }
        };
    }
    getConnection(opts) {
        const now = Date.now();
        if (this._sniffEnabled === true && now > this._nextSniff) {
            this.sniff({ reason: Transport.sniffReasons.SNIFF_INTERVAL, requestId: opts.requestId });
        }
        return this.connectionPool.getConnection({
            filter: this.nodeFilter,
            selector: this.nodeSelector,
            requestId: opts.requestId,
            name: this.name,
            now
        });
    }
    sniff(opts, callback = sniffNoop) {
        if (this._isSniffing === true)
            return;
        this._isSniffing = true;
        debug('Started sniffing request');
        if (typeof opts === 'function') {
            callback = opts;
            opts = { reason: Transport.sniffReasons.DEFAULT };
        }
        const { reason } = opts;
        const request = {
            method: 'GET',
            path: this.sniffEndpoint
        };
        this.request(request, { id: opts.requestId }, (err, result) => {
            this._isSniffing = false;
            if (this._sniffEnabled === true) {
                this._nextSniff = Date.now() + this.sniffInterval;
            }
            if (err != null) {
                debug('Sniffing errored', err);
                result.meta.sniff = { hosts: [], reason };
                this.emit('sniff', err, result);
                return callback(err, null);
            }
            debug('Sniffing ended successfully', result.body);
            const protocol = result.meta.connection.url.protocol || 'http:';
            const hosts = this.connectionPool.nodesToHost(result.body.nodes, protocol);
            this.connectionPool.update(hosts);
            result.meta.sniff = { hosts, reason };
            this.emit('sniff', null, result);
            callback(null, hosts);
        });
    }
}
Transport.sniffReasons = {
    SNIFF_ON_START: 'sniff-on-start',
    SNIFF_INTERVAL: 'sniff-interval',
    SNIFF_ON_CONNECTION_FAULT: 'sniff-on-connection-fault',
    DEFAULT: 'default'
};
Transport.sniffReasons = {
    SNIFF_ON_START: 'sniff-on-start',
    SNIFF_INTERVAL: 'sniff-interval',
    SNIFF_ON_CONNECTION_FAULT: 'sniff-on-connection-fault',
    DEFAULT: 'default'
};
function toMs(time) {
    if (typeof time === 'string') {
        return ms_1.default(time);
    }
    return time;
}
function shouldSerialize(obj) {
    return typeof obj !== 'string' &&
        typeof obj.pipe !== 'function' &&
        Buffer.isBuffer(obj) === false;
}
function isStream(obj) {
    return obj && typeof obj.pipe === 'function';
}
function defaultNodeFilter(node) {
    if (node.roles.master === true &&
        node.roles.data === false &&
        node.roles.ingest === false) {
        return false;
    }
    return true;
}
function roundRobinSelector() {
    var current = -1;
    return function _roundRobinSelector(connections) {
        if (++current >= connections.length) {
            current = 0;
        }
        return connections[current];
    };
}
function randomSelector(connections) {
    const index = Math.floor(Math.random() * connections.length);
    return connections[index];
}
function generateRequestId() {
    var maxInt = 2147483647;
    var nextReqId = 0;
    return function genReqId(params, options) {
        return (nextReqId = (nextReqId + 1) & maxInt);
    };
}
exports.default = Transport;
module.exports = exports.default;
module.exports.internals = { defaultNodeFilter, roundRobinSelector, randomSelector, generateRequestId };
//# sourceMappingURL=Transport.js.map