'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const url_1 = require("url");
const debug_1 = __importDefault(require("debug"));
const Connection_1 = __importDefault(require("../Connection"));
const debug = debug_1.default('elasticsearch');
const noop = () => { };
class BaseConnectionPool {
    constructor(opts) {
        this.connections = [];
        this.size = this.connections.length;
        this.Connection = opts.Connection;
        this.emit = opts.emit || noop;
        this.auth = opts.auth || null;
        this._ssl = opts.ssl || null;
        this._agent = opts.agent || null;
    }
    getConnection() {
        throw new Error('getConnection must be implemented');
    }
    markAlive(connection) {
        return this;
    }
    markDead(connection) {
        return this;
    }
    createConnection(opts) {
        if (typeof opts === 'string') {
            opts = this.urlToHost(opts);
        }
        if (opts.url.username !== '' && opts.url.password !== '') {
            opts.auth = {
                username: decodeURIComponent(opts.url.username),
                password: decodeURIComponent(opts.url.password)
            };
        }
        else if (this.auth !== null) {
            opts.auth = this.auth;
        }
        if (opts.ssl == null)
            opts.ssl = this._ssl;
        if (opts.agent == null)
            opts.agent = this._agent;
        const connection = new this.Connection(opts);
        for (const conn of this.connections) {
            if (conn.id === connection.id) {
                throw new Error(`Connection with id '${connection.id}' is already present`);
            }
        }
        return connection;
    }
    addConnection(opts) {
        if (Array.isArray(opts)) {
            return opts.forEach(o => this.addConnection(o));
        }
        if (typeof opts === 'string') {
            opts = this.urlToHost(opts);
        }
        const connectionById = this.connections.find(c => c.id === opts.id);
        const connectionByUrl = this.connections.find(c => c.id === opts.url.href);
        if (connectionById || connectionByUrl) {
            throw new Error(`Connection with id '${opts.id || opts.url.href}' is already present`);
        }
        this.update([...this.connections, opts]);
        return this.connections[this.size - 1];
    }
    removeConnection(connection) {
        debug('Removing connection', connection);
        return this.update(this.connections.filter(c => c.id !== connection.id));
    }
    empty(callback) {
        debug('Emptying the connection pool');
        var openConnections = this.size;
        this.connections.forEach(connection => {
            connection.close(() => {
                if (--openConnections === 0) {
                    this.connections = [];
                    this.size = this.connections.length;
                    callback();
                }
            });
        });
    }
    update(nodes) {
        debug('Updating the connection pool');
        const newConnections = [];
        const oldConnections = [];
        for (const node of nodes) {
            const connectionById = this.connections.find(c => c.id === node.id);
            const connectionByUrl = this.connections.find(c => c.id === node.url.href);
            if (connectionById) {
                debug(`The connection with id '${node.id}' is already present`);
                this.markAlive(connectionById);
                newConnections.push(connectionById);
            }
            else if (connectionByUrl) {
                connectionByUrl.id = node.id;
                this.markAlive(connectionByUrl);
                newConnections.push(connectionByUrl);
            }
            else {
                newConnections.push(this.createConnection(node));
            }
        }
        const ids = nodes.map(c => c.id);
        for (const connection of this.connections) {
            if (ids.indexOf(connection.id) === -1) {
                oldConnections.push(connection);
            }
        }
        oldConnections.forEach(connection => connection.close());
        this.connections = newConnections;
        this.size = this.connections.length;
        return this;
    }
    nodesToHost(nodes, protocol) {
        const ids = Object.keys(nodes);
        const hosts = [];
        for (var i = 0, len = ids.length; i < len; i++) {
            const node = nodes[ids[i]];
            var address = node.http.publish_address;
            const parts = address.split('/');
            if (parts.length > 1) {
                const hostname = parts[0];
                const port = parts[1].match(/((?::))(?:[0-9]+)$/g)[0].slice(1);
                address = `${hostname}:${port}`;
            }
            address = address.slice(0, 4) === 'http'
                ? address
                : `${protocol}//${address}`;
            const roles = node.roles.reduce((acc, role) => {
                acc[role] = true;
                return acc;
            }, {});
            hosts.push({
                url: new url_1.URL(address),
                id: ids[i],
                roles: Object.assign({
                    [Connection_1.default.roles.MASTER]: false,
                    [Connection_1.default.roles.DATA]: false,
                    [Connection_1.default.roles.INGEST]: false,
                    [Connection_1.default.roles.ML]: false
                }, roles)
            });
        }
        return hosts;
    }
    urlToHost(url) {
        return {
            url: new url_1.URL(url)
        };
    }
}
exports.default = BaseConnectionPool;
module.exports = exports.default;
//# sourceMappingURL=BaseConnectionPool.js.map