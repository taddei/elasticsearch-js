'use strict';
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const assert_1 = __importDefault(require("assert"));
const util_1 = require("util");
const http_1 = __importDefault(require("http"));
const https_1 = __importDefault(require("https"));
const debug_1 = __importDefault(require("debug"));
const decompress_response_1 = __importDefault(require("decompress-response"));
const pump_1 = __importDefault(require("pump"));
const errors_1 = require("./errors");
const debug = debug_1.default('elasticsearch');
const INVALID_PATH_REGEX = /[^\u0021-\u00ff]/;
class Connection {
    constructor(opts) {
        this.url = opts.url;
        this.ssl = opts.ssl || null;
        this.id = opts.id || stripAuth(opts.url.href);
        this.headers = prepareHeaders(opts.headers, opts.auth);
        this.deadCount = 0;
        this.resurrectTimeout = 0;
        this._openRequests = 0;
        this._status = opts.status || Connection.statuses.ALIVE;
        this.roles = Object.assign({}, defaultRoles, opts.roles);
        if (!['http:', 'https:'].includes(this.url.protocol)) {
            throw new errors_1.ConfigurationError(`Invalid protocol: '${this.url.protocol}'`);
        }
        if (typeof opts.agent === 'function') {
            this.agent = opts.agent();
        }
        else {
            const keepAliveFalse = opts.agent && opts.agent.keepAlive === false;
            const agentOptions = Object.assign({}, {
                keepAlive: true,
                keepAliveMsecs: 1000,
                maxSockets: keepAliveFalse ? Infinity : 256,
                maxFreeSockets: 256
            }, opts.agent);
            this.agent = this.url.protocol === 'http:'
                ? new http_1.default.Agent(agentOptions)
                : new https_1.default.Agent(Object.assign({}, agentOptions, this.ssl));
        }
        this.makeRequest = this.url.protocol === 'http:'
            ? http_1.default.request
            : https_1.default.request;
    }
    request(params, callback) {
        this._openRequests++;
        var ended = false;
        const requestParams = this.buildRequestObject(params);
        if (INVALID_PATH_REGEX.test(requestParams.path) === true) {
            callback(new TypeError(`ERR_UNESCAPED_CHARACTERS: ${requestParams.path}`), null);
            return { abort: () => { } };
        }
        debug('Starting a new request', params);
        const request = this.makeRequest(requestParams);
        request.on('response', response => {
            if (ended === false) {
                ended = true;
                this._openRequests--;
                if (params.asStream === true) {
                    callback(null, response);
                }
                else {
                    callback(null, decompress_response_1.default(response));
                }
            }
        });
        request.on('timeout', () => {
            if (ended === false) {
                ended = true;
                this._openRequests--;
                request.abort();
                callback(new errors_1.TimeoutError('Request timed out', params), null);
            }
        });
        request.on('error', err => {
            if (ended === false) {
                ended = true;
                this._openRequests--;
                callback(err, null);
            }
        });
        request.on('abort', () => {
            debug('Request aborted', params);
            if (ended === false) {
                ended = true;
                this._openRequests--;
            }
        });
        request.setNoDelay(true);
        if (isStream(params.body) === true) {
            pump_1.default(params.body, request, err => {
                if (err != null && ended === false) {
                    ended = true;
                    this._openRequests--;
                    callback(err, null);
                }
            });
        }
        else {
            request.end(params.body);
        }
        return request;
    }
    close(callback = () => { }) {
        debug('Closing connection', this.id);
        if (this._openRequests > 0) {
            setTimeout(() => this.close(callback), 1000);
        }
        else {
            this.agent.destroy();
            callback();
        }
    }
    setRole(role, enabled) {
        if (validRoles.indexOf(role) === -1) {
            throw new errors_1.ConfigurationError(`Unsupported role: '${role}'`);
        }
        if (typeof enabled !== 'boolean') {
            throw new errors_1.ConfigurationError('enabled should be a boolean');
        }
        this.roles[role] = enabled;
        return this;
    }
    get status() {
        return this._status;
    }
    set status(status) {
        assert_1.default(~validStatuses.indexOf(status), `Unsupported status: '${status}'`);
        this._status = status;
    }
    buildRequestObject(params) {
        const url = this.url;
        const request = {
            protocol: url.protocol,
            hostname: url.hostname[0] === '['
                ? url.hostname.slice(1, -1)
                : url.hostname,
            hash: url.hash,
            search: url.search,
            pathname: url.pathname,
            path: '',
            href: url.href,
            origin: url.origin,
            port: url.port !== '' ? url.port : undefined,
            headers: this.headers,
            agent: this.agent
        };
        const paramsKeys = Object.keys(params);
        for (var i = 0, len = paramsKeys.length; i < len; i++) {
            var key = paramsKeys[i];
            if (key === 'path') {
                request.pathname = resolve(request.pathname, params[key]);
            }
            else if (key === 'querystring' && !!params[key] === true) {
                if (request.search === '') {
                    request.search = '?' + params[key];
                }
                else {
                    request.search += '&' + params[key];
                }
            }
            else if (key === 'headers') {
                request.headers = Object.assign({}, request.headers, params.headers);
            }
            else {
                request[key] = params[key];
            }
        }
        request.path = request.pathname + request.search;
        return request;
    }
    [util_1.inspect.custom](depth, options) {
        const _a = this.headers, { authorization } = _a, headers = __rest(_a, ["authorization"]);
        return {
            url: stripAuth(this.url.toString()),
            id: this.id,
            headers,
            deadCount: this.deadCount,
            resurrectTimeout: this.resurrectTimeout,
            _openRequests: this._openRequests,
            status: this.status,
            roles: this.roles
        };
    }
    toJSON() {
        const _a = this.headers, { authorization } = _a, headers = __rest(_a, ["authorization"]);
        return {
            url: stripAuth(this.url.toString()),
            id: this.id,
            headers,
            deadCount: this.deadCount,
            resurrectTimeout: this.resurrectTimeout,
            _openRequests: this._openRequests,
            status: this.status,
            roles: this.roles
        };
    }
}
Connection.statuses = {
    ALIVE: 'alive',
    DEAD: 'dead'
};
Connection.roles = {
    MASTER: 'master',
    DATA: 'data',
    INGEST: 'ingest',
    ML: 'ml'
};
const defaultRoles = {
    [Connection.roles.MASTER]: true,
    [Connection.roles.DATA]: true,
    [Connection.roles.INGEST]: true,
    [Connection.roles.ML]: false
};
const validStatuses = Object.keys(Connection.statuses)
    .map(k => Connection.statuses[k]);
const validRoles = Object.keys(Connection.roles)
    .map(k => Connection.roles[k]);
function stripAuth(url) {
    if (url.indexOf('@') === -1)
        return url;
    return url.slice(0, url.indexOf('//') + 2) + url.slice(url.indexOf('@') + 1);
}
function isStream(obj) {
    return obj != null && typeof obj.pipe === 'function';
}
function resolve(host, path) {
    const hostEndWithSlash = host[host.length - 1] === '/';
    const pathStartsWithSlash = path[0] === '/';
    if (hostEndWithSlash === true && pathStartsWithSlash === true) {
        return host + path.slice(1);
    }
    else if (hostEndWithSlash !== pathStartsWithSlash) {
        return host + path;
    }
    else {
        return host + '/' + path;
    }
}
function prepareHeaders(headers, auth) {
    headers = headers || {};
    if (auth != null && headers.authorization == null) {
        if (auth.username && auth.password) {
            headers.authorization = 'Basic ' + Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
        }
        if (auth.apiKey) {
            if (typeof auth.apiKey === 'object') {
                headers.authorization = 'ApiKey ' + Buffer.from(`${auth.apiKey.id}:${auth.apiKey.api_key}`).toString('base64');
            }
            else {
                headers.authorization = `ApiKey ${auth.apiKey}`;
            }
        }
    }
    return headers;
}
exports.default = Connection;
module.exports = exports.default;
//# sourceMappingURL=Connection.js.map