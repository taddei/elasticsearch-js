'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const BaseConnectionPool_1 = __importDefault(require("./BaseConnectionPool"));
class CloudConnectionPool extends BaseConnectionPool_1.default {
    constructor(opts) {
        super(opts);
        this.cloudConnection = null;
    }
    getConnection() {
        return this.cloudConnection;
    }
    empty(callback) {
        super.empty(() => {
            this.cloudConnection = null;
            callback();
        });
    }
    update(connections) {
        super.update(connections);
        this.cloudConnection = this.connections[0];
        return this;
    }
}
exports.default = CloudConnectionPool;
module.exports = exports.default;
//# sourceMappingURL=CloudConnectionPool.js.map