'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
class ElasticsearchClientError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ElasticsearchClientError';
    }
}
exports.ElasticsearchClientError = ElasticsearchClientError;
class TimeoutError extends ElasticsearchClientError {
    constructor(message, meta) {
        super(message);
        Error.captureStackTrace(this, TimeoutError);
        this.name = 'TimeoutError';
        this.message = message || 'Timeout Error';
        this.meta = meta;
    }
}
exports.TimeoutError = TimeoutError;
class ConnectionError extends ElasticsearchClientError {
    constructor(message, meta) {
        super(message);
        Error.captureStackTrace(this, ConnectionError);
        this.name = 'ConnectionError';
        this.message = message || 'Connection Error';
        this.meta = meta;
    }
}
exports.ConnectionError = ConnectionError;
class NoLivingConnectionsError extends ElasticsearchClientError {
    constructor(message, meta) {
        super(message);
        Error.captureStackTrace(this, NoLivingConnectionsError);
        this.name = 'NoLivingConnectionsError';
        this.message = message || 'No Living Connections Error';
        this.meta = meta;
    }
}
exports.NoLivingConnectionsError = NoLivingConnectionsError;
class SerializationError extends ElasticsearchClientError {
    constructor(message) {
        super(message);
        Error.captureStackTrace(this, SerializationError);
        this.name = 'SerializationError';
        this.message = message || 'Serialization Error';
    }
}
exports.SerializationError = SerializationError;
class DeserializationError extends ElasticsearchClientError {
    constructor(message) {
        super(message);
        Error.captureStackTrace(this, DeserializationError);
        this.name = 'DeserializationError';
        this.message = message || 'Deserialization Error';
    }
}
exports.DeserializationError = DeserializationError;
class ConfigurationError extends ElasticsearchClientError {
    constructor(message) {
        super(message);
        Error.captureStackTrace(this, ConfigurationError);
        this.name = 'ConfigurationError';
        this.message = message || 'Configuration Error';
    }
}
exports.ConfigurationError = ConfigurationError;
class ResponseError extends ElasticsearchClientError {
    constructor(meta) {
        super('Response Error');
        Error.captureStackTrace(this, ResponseError);
        this.name = 'ResponseError';
        this.message = (meta.body && meta.body.error && meta.body.error.type) || 'Response Error';
        this.meta = meta;
    }
    get body() {
        return this.meta.body;
    }
    get statusCode() {
        if (this.meta.body && typeof this.meta.body.status === 'number') {
            return this.meta.body.status;
        }
        return this.meta.statusCode;
    }
    get headers() {
        return this.meta.headers;
    }
}
exports.ResponseError = ResponseError;
//# sourceMappingURL=errors.js.map