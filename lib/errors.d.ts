export declare class ElasticsearchClientError extends Error {
    constructor(message: any);
}
export declare class TimeoutError extends ElasticsearchClientError {
    meta: Record<string, any>;
    constructor(message: any, meta: any);
}
export declare class ConnectionError extends ElasticsearchClientError {
    meta: Record<string, any>;
    constructor(message: any, meta: any);
}
export declare class NoLivingConnectionsError extends ElasticsearchClientError {
    meta: Record<string, any>;
    constructor(message: any, meta: any);
}
export declare class SerializationError extends ElasticsearchClientError {
    constructor(message: any);
}
export declare class DeserializationError extends ElasticsearchClientError {
    constructor(message: any);
}
export declare class ConfigurationError extends ElasticsearchClientError {
    constructor(message: any);
}
export declare class ResponseError extends ElasticsearchClientError {
    meta: Record<string, any>;
    constructor(meta: any);
    readonly body: any;
    readonly statusCode: any;
    readonly headers: any;
}
