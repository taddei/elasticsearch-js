'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const BaseConnectionPool_1 = __importDefault(require("./BaseConnectionPool"));
const assert_1 = __importDefault(require("assert"));
const debug_1 = __importDefault(require("debug"));
const Connection_1 = __importDefault(require("../Connection"));
const debug = debug_1.default('elasticsearch');
const noop = (a, b) => { };
class ConnectionPool extends BaseConnectionPool_1.default {
    constructor(opts) {
        super(opts);
        this.dead = [];
        this.resurrectTimeout = 1000 * 60;
        this.resurrectTimeoutCutoff = 5;
        this.pingTimeout = opts.pingTimeout;
        this._sniffEnabled = opts.sniffEnabled || false;
        const resurrectStrategy = opts.resurrectStrategy || 'ping';
        this.resurrectStrategy = ConnectionPool.resurrectStrategies[resurrectStrategy];
        assert_1.default(this.resurrectStrategy != null, `Invalid resurrection strategy: '${resurrectStrategy}'`);
    }
    markAlive(connection) {
        if (this._sniffEnabled === false && this.size === 1)
            return this;
        const { id } = connection;
        debug(`Marking as 'alive' connection '${id}'`);
        const index = this.dead.indexOf(id);
        if (index > -1)
            this.dead.splice(index, 1);
        connection.status = Connection_1.default.statuses.ALIVE;
        connection.deadCount = 0;
        connection.resurrectTimeout = 0;
        return this;
    }
    markDead(connection) {
        if (this._sniffEnabled === false && this.size === 1)
            return this;
        const { id } = connection;
        debug(`Marking as 'dead' connection '${id}'`);
        if (this.dead.indexOf(id) === -1) {
            this.dead.push(id);
        }
        connection.status = Connection_1.default.statuses.DEAD;
        connection.deadCount++;
        connection.resurrectTimeout = Date.now() + this.resurrectTimeout * Math.pow(2, Math.min(connection.deadCount - 1, this.resurrectTimeoutCutoff));
        this.dead.sort((a, b) => {
            const conn1 = this.connections.find(c => c.id === a);
            const conn2 = this.connections.find(c => c.id === b);
            return conn1.resurrectTimeout - conn2.resurrectTimeout;
        });
        return this;
    }
    resurrect(opts, callback = noop) {
        if (this.resurrectStrategy === 0 || this.dead.length === 0) {
            debug('Nothing to resurrect');
            callback(null, null);
            return;
        }
        const connection = this.connections.find(c => c.id === this.dead[0]);
        if ((opts.now || Date.now()) < connection.resurrectTimeout) {
            debug('Nothing to resurrect');
            callback(null, null);
            return;
        }
        const { id } = connection;
        if (this.resurrectStrategy === 1) {
            connection.request({
                method: 'HEAD',
                path: '/',
                timeout: this.pingTimeout
            }, (err, response) => {
                var isAlive = true;
                const statusCode = response !== null ? response.statusCode : 0;
                if (err != null ||
                    (statusCode === 502 || statusCode === 503 || statusCode === 504)) {
                    debug(`Resurrect: connection '${id}' is still dead`);
                    this.markDead(connection);
                    isAlive = false;
                }
                else {
                    debug(`Resurrect: connection '${id}' is now alive`);
                    this.markAlive(connection);
                }
                this.emit('resurrect', null, {
                    strategy: 'ping',
                    name: opts.name,
                    request: { id: opts.requestId },
                    isAlive,
                    connection
                });
                callback(isAlive, connection);
            });
        }
        else {
            debug(`Resurrect: optimistic resurrection for connection '${id}'`);
            this.dead.splice(this.dead.indexOf(id), 1);
            connection.status = Connection_1.default.statuses.ALIVE;
            this.emit('resurrect', null, {
                strategy: 'optimistic',
                name: opts.name,
                request: { id: opts.requestId },
                isAlive: true,
                connection
            });
            callback(true, connection);
        }
    }
    getConnection(opts = {}) {
        const filter = opts.filter || (() => true);
        const selector = opts.selector || (c => c[0]);
        this.resurrect({
            now: opts.now,
            requestId: opts.requestId,
            name: opts.name
        });
        const connections = [];
        for (var i = 0; i < this.size; i++) {
            const connection = this.connections[i];
            if (connection.status === Connection_1.default.statuses.ALIVE) {
                if (filter(connection) === true) {
                    connections.push(connection);
                }
            }
        }
        if (connections.length === 0)
            return null;
        return selector(connections);
    }
    empty(callback) {
        super.empty(() => {
            this.dead = [];
            callback();
        });
    }
    update(connections) {
        super.update(connections);
        for (var i = 0; i < this.dead.length; i++) {
            if (this.connections.find(c => c.id === this.dead[i]) === undefined) {
                this.dead.splice(i, 1);
            }
        }
        return this;
    }
}
ConnectionPool.resurrectStrategies = {
    none: 0,
    ping: 1,
    optimistic: 2
};
exports.default = ConnectionPool;
module.exports = exports.default;
//# sourceMappingURL=ConnectionPool.js.map