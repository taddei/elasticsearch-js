'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const querystring_1 = require("querystring");
const debug_1 = __importDefault(require("debug"));
const errors_1 = require("./errors");
const debug = debug_1.default('elasticsearch');
class Serializer {
    serialize(object) {
        debug('Serializing', object);
        try {
            var json = JSON.stringify(object);
        }
        catch (err) {
            throw new errors_1.SerializationError(err.message);
        }
        return json;
    }
    deserialize(json) {
        debug('Deserializing', json);
        try {
            var object = JSON.parse(json);
        }
        catch (err) {
            throw new errors_1.DeserializationError(err.message);
        }
        return object;
    }
    ndserialize(array) {
        debug('ndserialize', array);
        if (Array.isArray(array) === false) {
            throw new errors_1.SerializationError('The argument provided is not an array');
        }
        var ndjson = '';
        for (var i = 0, len = array.length; i < len; i++) {
            if (typeof array[i] === 'string') {
                ndjson += array[i] + '\n';
            }
            else {
                ndjson += this.serialize(array[i]) + '\n';
            }
        }
        return ndjson;
    }
    qserialize(object) {
        debug('qserialize', object);
        if (object == null)
            return '';
        if (typeof object === 'string')
            return object;
        const keys = Object.keys(object);
        for (var i = 0, len = keys.length; i < len; i++) {
            var key = keys[i];
            if (object[key] === undefined) {
                delete object[key];
            }
            else if (Array.isArray(object[key]) === true) {
                object[key] = object[key].join(',');
            }
        }
        return querystring_1.stringify(object);
    }
}
exports.default = Serializer;
module.exports = exports.default;
//# sourceMappingURL=Serializer.js.map