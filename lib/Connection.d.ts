/// <reference types="node" />
import { URL } from 'url';
import { inspect } from 'util';
import { Readable as ReadableStream } from 'stream';
import { ConnectionOptions as TlsConnectionOptions } from 'tls';
import { BasicAuth, ApiKeyAuth } from './pool/BaseConnectionPool';
import http from 'http';
export declare type agentFn = () => any;
export interface AgentOptions {
    keepAlive: boolean;
    keepAliveMsecs: number;
    maxSockets: number;
    maxFreeSockets: number;
}
interface ConnectionOptions {
    url: URL;
    ssl?: TlsConnectionOptions;
    id?: string;
    headers?: any;
    agent?: AgentOptions | agentFn;
    status?: string;
    roles?: any;
    auth?: BasicAuth | ApiKeyAuth;
}
export interface ConnectionRequestOptions extends http.ClientRequestArgs {
    asStream?: boolean;
    body?: string | ReadableStream;
    querystring?: string;
}
declare class Connection {
    url: URL;
    ssl: TlsConnectionOptions | null;
    id: string;
    headers: any;
    deadCount: number;
    resurrectTimeout: number;
    statuses: any;
    roles: any;
    makeRequest: any;
    agent: http.Agent;
    _openRequests: number;
    _status: string;
    static statuses: {
        ALIVE: string;
        DEAD: string;
    };
    static roles: {
        MASTER: string;
        DATA: string;
        INGEST: string;
        ML: string;
    };
    constructor(opts: ConnectionOptions);
    request(params: ConnectionRequestOptions, callback: any): any;
    close(callback?: () => void): void;
    setRole(role: any, enabled: any): this;
    status: string;
    buildRequestObject(params: any): {
        protocol: string;
        hostname: string;
        hash: string;
        search: string;
        pathname: string;
        path: string;
        href: string;
        origin: string;
        port: string | undefined;
        headers: any;
        agent: http.Agent;
    };
    [inspect.custom](depth: any, options: any): {
        url: any;
        id: string;
        headers: any;
        deadCount: number;
        resurrectTimeout: number;
        _openRequests: number;
        status: string;
        roles: any;
    };
    toJSON(): {
        url: any;
        id: string;
        headers: any;
        deadCount: number;
        resurrectTimeout: number;
        _openRequests: number;
        status: string;
        roles: any;
    };
}
export default Connection;
