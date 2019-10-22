/// <reference types="node" />
import { Readable as ReadableStream } from 'stream';
import { ConnectionPool, CloudConnectionPool } from './pool';
import Serializer from './Serializer';
import Connection, { ConnectionRequestOptions } from './Connection';
declare type noopFn = (...args: any[]) => void;
declare type emitFn = (event: string | symbol, ...args: any[]) => boolean;
export declare type nodeFilterFn = (connection: Connection) => boolean;
export declare type nodeSelectorFn = (connections: Connection[]) => Connection;
export declare type generateRequestIdFn = (params: TransportRequestParams, options: TransportRequestOptions) => any;
declare type TransportRequestCallback = (err: Error | null, result: ApiResponse) => void;
export interface TransportRequestReturn {
    abort: () => void;
}
export interface TransportRequestParams {
    method: string;
    path: string;
    body?: Record<string, any> | string | ReadableStream;
    bulkBody?: Array<Record<string, any>> | string | ReadableStream;
    querystring?: Record<string, any>;
}
export interface TransportRequestOptions {
    ignore?: [number];
    requestTimeout?: number | string;
    maxRetries?: number;
    asStream?: boolean;
    headers?: Record<string, any>;
    querystring?: Record<string, any>;
    compression?: string;
    id?: any;
    context?: any;
    warnings?: [string];
}
interface RequestMeta<C = any> {
    context: C;
    name: string;
    request: {
        params: ConnectionRequestOptions;
        options: TransportRequestOptions;
        id: any;
    };
    connection: Connection | null;
    attempts: number;
    aborted: boolean;
    sniff?: {
        hosts: any[];
        reason: string;
    };
}
export interface ApiResponse<T = any, C = any> {
    body: T;
    statusCode: number | null;
    headers: Record<string, any> | null;
    warnings: string[] | null;
    meta: RequestMeta<C>;
}
export interface RequestEvent extends ApiResponse {
}
interface TransportOptions {
    emit: emitFn & noopFn;
    connectionPool: ConnectionPool | CloudConnectionPool;
    serializer: Serializer;
    maxRetries: number;
    requestTimeout: number | string;
    suggestCompression: boolean;
    compression?: 'gzip';
    sniffInterval: number | boolean;
    sniffOnConnectionFault: boolean;
    sniffEndpoint: string;
    sniffOnStart: boolean;
    nodeFilter?: nodeFilterFn;
    nodeSelector?: string | nodeSelectorFn;
    headers?: Record<string, any>;
    generateRequestId?: generateRequestIdFn;
    name: string;
}
declare class Transport {
    static sniffReasons: {
        SNIFF_ON_START: string;
        SNIFF_INTERVAL: string;
        SNIFF_ON_CONNECTION_FAULT: string;
        DEFAULT: string;
    };
    emit: emitFn & noopFn;
    connectionPool: ConnectionPool | CloudConnectionPool;
    serializer: Serializer;
    maxRetries: number;
    requestTimeout: number;
    suggestCompression: boolean;
    compression: 'gzip' | false;
    headers: Record<string, any>;
    sniffInterval: number;
    sniffOnConnectionFault: boolean;
    sniffEndpoint: string;
    generateRequestId: generateRequestIdFn;
    nodeFilter: nodeFilterFn;
    nodeSelector: nodeSelectorFn;
    _sniffEnabled: boolean;
    name: string;
    _nextSniff: number;
    _isSniffing: boolean;
    constructor(opts: TransportOptions);
    request(params: TransportRequestParams, options?: TransportRequestOptions): Promise<ApiResponse>;
    request(params: TransportRequestParams, options?: TransportRequestOptions, callback?: TransportRequestCallback): TransportRequestReturn;
    getConnection(opts: any): Connection | null;
    sniff(opts: any, callback?: (err: any, hosts: any) => void): void;
}
export default Transport;
