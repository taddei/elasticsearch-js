// Licensed to Elasticsearch B.V under one or more agreements.
// Elasticsearch B.V licenses this file to you under the Apache 2.0 License.
// See the LICENSE file in the project root for more information

'use strict'

/* eslint no-unused-vars: "off" */
/* eslint lines-between-class-members: "off" */
/* eslint no-dupe-class-members: "off" */

import Debug from 'debug'
import os from 'os'
import { createGzip } from 'zlib'
import intoStream from 'into-stream'
import { Readable as ReadableStream } from 'stream'
import ms from 'ms'
import { ConnectionPool, CloudConnectionPool } from './pool'
import Serializer from './Serializer'
import Connection, { ConnectionRequestOptions } from './Connection'
import {
  ConnectionError,
  TimeoutError,
  NoLivingConnectionsError,
  ResponseError,
  ConfigurationError
} from './errors'

const debug = Debug('elasticsearch')
const noop = () => {}
const sniffNoop = (e, hosts) => {}

const clientVersion = require('../package.json').version
const userAgent = `elasticsearch-js/${clientVersion} (${os.platform()} ${os.release()}-${os.arch()}; Node.js ${process.version})`

type noopFn = (...args: any[]) => void
type emitFn = (event: string | symbol, ...args: any[]) => boolean
type TransportErrors = ConnectionError | TimeoutError | NoLivingConnectionsError | ResponseError | ConfigurationError
export type nodeFilterFn = (connection: Connection) => boolean
export type nodeSelectorFn = (connections: Connection[]) => Connection
export type generateRequestIdFn = (params: TransportRequestParams, options: TransportRequestOptions) => any
type TransportRequestCallback = (err: TransportErrors | null, result: ApiResponse) => void

export interface TransportRequestReturn {
  abort: () => void
}

export interface TransportRequestParams {
  method: string
  path: string
  body?: Record<string, any> | string | ReadableStream
  bulkBody?: Array<Record<string, any>> | string | ReadableStream
  querystring?: Record<string, any>
}

export interface TransportRequestOptions {
  ignore?: number[]
  requestTimeout?: number | string
  maxRetries?: number
  asStream?: boolean
  headers?: Record<string, any>
  querystring?: Record<string, any>
  compression?: string
  id?: any
  context?: any
  warnings?: [string]
}

interface RequestMeta<C = any> {
  context: C
  name: string
  request: {
    params: ConnectionRequestOptions
    options: TransportRequestOptions
    id: any
  }
  connection: Connection | null
  attempts: number
  aborted: boolean
  sniff?: {
    hosts: any[]
    reason: string
  }
}

export interface ApiResponse<T = any, C = any> {
  body: T
  statusCode: number | null
  headers: Record<string, any> | null
  warnings: string[] | null
  meta: RequestMeta<C>
}

export interface RequestEvent extends ApiResponse {}

interface TransportOptions {
  emit: emitFn
  connectionPool: ConnectionPool | CloudConnectionPool
  serializer: Serializer
  maxRetries: number
  requestTimeout: number | string
  suggestCompression: boolean
  compression?: 'gzip'
  sniffInterval: number| boolean
  sniffOnConnectionFault: boolean
  sniffEndpoint: string
  sniffOnStart: boolean
  nodeFilter?: nodeFilterFn
  nodeSelector?: string | nodeSelectorFn
  headers?: Record<string, any>
  generateRequestId?: generateRequestIdFn
  name: string
}

class Transport {
  static sniffReasons = {
    SNIFF_ON_START: 'sniff-on-start',
    SNIFF_INTERVAL: 'sniff-interval',
    SNIFF_ON_CONNECTION_FAULT: 'sniff-on-connection-fault',
    DEFAULT: 'default'
  }
  emit: emitFn & noopFn
  connectionPool: ConnectionPool | CloudConnectionPool
  serializer: Serializer
  maxRetries: number
  requestTimeout: number
  suggestCompression: boolean
  compression: 'gzip' | false
  headers: Record<string, any>
  sniffInterval: number
  sniffOnConnectionFault: boolean
  sniffEndpoint: string
  generateRequestId: generateRequestIdFn
  nodeFilter: nodeFilterFn
  nodeSelector: nodeSelectorFn
  _sniffEnabled: boolean
  name: string
  _nextSniff: number
  _isSniffing: boolean

  constructor (opts: TransportOptions) {
    if (typeof opts.compression === 'string' && opts.compression !== 'gzip') {
      throw new ConfigurationError(`Invalid compression: '${opts.compression}'`)
    }
    this.emit = opts.emit
    this.connectionPool = opts.connectionPool
    this.serializer = opts.serializer
    this.maxRetries = opts.maxRetries
    this.requestTimeout = toMs(opts.requestTimeout)
    this.suggestCompression = opts.suggestCompression === true
    this.compression = opts.compression || false
    this.headers = Object.assign({}, { 'User-Agent': userAgent }, opts.headers)
    this.sniffInterval = typeof opts.sniffInterval === 'number' ? opts.sniffInterval : -1
    this.sniffOnConnectionFault = opts.sniffOnConnectionFault
    this.sniffEndpoint = opts.sniffEndpoint
    this.generateRequestId = opts.generateRequestId || generateRequestId()
    this.name = opts.name

    this.nodeFilter = opts.nodeFilter || defaultNodeFilter
    if (typeof opts.nodeSelector === 'function') {
      this.nodeSelector = opts.nodeSelector
    } else if (opts.nodeSelector === 'round-robin') {
      this.nodeSelector = roundRobinSelector()
    } else if (opts.nodeSelector === 'random') {
      this.nodeSelector = randomSelector
    } else {
      this.nodeSelector = roundRobinSelector()
    }

    this._sniffEnabled = this.sniffInterval > -1
    this._nextSniff = this._sniffEnabled ? (Date.now() + this.sniffInterval) : 0
    this._isSniffing = false

    if (opts.sniffOnStart === true) {
      this.sniff({ reason: Transport.sniffReasons.SNIFF_ON_START })
    }
  }

  request (params: TransportRequestParams, options?: TransportRequestOptions): Promise<ApiResponse>
  request (params: TransportRequestParams, callback: TransportRequestCallback): TransportRequestReturn
  request (params: TransportRequestParams, options: TransportRequestOptions, callback: TransportRequestCallback): TransportRequestReturn
  request (params: TransportRequestParams, options?, callback?) {
    options = options || {}
    if (typeof options === 'function') {
      callback = options
      options = {}
    }

    // promises support
    if (callback === undefined) {
      return new Promise((resolve, reject) => {
        this.request(params, options, (err, result) => {
          err ? reject(err) : resolve(result)
        })
      })
    }

    const requestParams: ConnectionRequestOptions = {
      path: params.path,
      method: params.method,
      body: undefined,
      asStream: false,
      querystring: undefined,
      headers: {},
      timeout: undefined
    }

    const meta: RequestMeta = {
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
    }

    const result: ApiResponse = {
      body: null,
      statusCode: null,
      headers: null,
      warnings: options.warnings || null,
      meta
    }

    const maxRetries = options.maxRetries || this.maxRetries
    const compression = options.compression || this.compression
    var request = { abort: noop }

    const makeRequest = () => {
      if (meta.aborted === true) return
      meta.connection = this.getConnection({ requestId: meta.request.id })
      if (meta.connection === null) {
        return callback(new NoLivingConnectionsError('There are not living connections', result), result)
      }

      const headers = Object.assign({}, this.headers, options.headers)

      // handle json body
      if (params.body !== null && params.body !== undefined) {
        if (shouldSerialize(params.body) === true) {
          try {
            requestParams.body = this.serializer.serialize(params.body)
          } catch (err) {
            return callback(err, result)
          }
        } else if (params.body !== '') {
          requestParams.body = params.body as string | ReadableStream
        }
        headers['Content-Type'] = headers['Content-Type'] || 'application/json'

        if (compression === 'gzip' && requestParams.body !== undefined) {
          if (isStream(requestParams.body)) {
            requestParams.body = requestParams.body.pipe(createGzip())
          } else {
            requestParams.body = intoStream(requestParams.body).pipe(createGzip())
          }
          headers['Content-Encoding'] = compression
        }

        if (requestParams.body !== undefined && !isStream(requestParams.body)) {
          headers['Content-Length'] = '' + Buffer.byteLength(requestParams.body)
        }
      // handle ndjson body
      } else if (params.bulkBody != null) {
        if (shouldSerialize(params.bulkBody) === true) {
          try {
            requestParams.body = this.serializer.ndserialize(params.bulkBody)
          } catch (err) {
            return callback(err, result)
          }
        } else if (params.bulkBody !== '') {
          requestParams.body = params.bulkBody as string | ReadableStream
        }
        headers['Content-Type'] = headers['Content-Type'] || 'application/x-ndjson'

        if (compression === 'gzip' && requestParams.body !== undefined) {
          if (isStream(requestParams.body)) {
            requestParams.body = requestParams.body.pipe(createGzip())
          } else {
            requestParams.body = intoStream(requestParams.body).pipe(createGzip())
          }
          headers['Content-Encoding'] = compression
        }

        if (requestParams.body !== undefined && !isStream(requestParams.body)) {
          headers['Content-Length'] = '' + Buffer.byteLength(requestParams.body)
        }
      }

      if (this.suggestCompression === true) {
        headers['Accept-Encoding'] = 'gzip,deflate'
      }

      requestParams.headers = headers
      // serializes the querystring
      if (options.querystring == null) {
        requestParams.querystring = this.serializer.qserialize(params.querystring)
      } else {
        requestParams.querystring = this.serializer.qserialize(
          Object.assign({}, params.querystring, options.querystring)
        )
      }

      // handles request timeout
      requestParams.timeout = toMs(options.requestTimeout || this.requestTimeout)
      if (options.asStream === true) requestParams.asStream = true
      this.emit('request', null, result)
      // perform the actual http request
      return meta.connection.request(requestParams, onResponse)
    }

    const onResponse = (err, response) => {
      if (err !== null) {
        // if there is an error in the connection
        // let's mark the connection as dead
        this.connectionPool.markDead(meta.connection!)

        if (this.sniffOnConnectionFault === true) {
          this.sniff({
            reason: Transport.sniffReasons.SNIFF_ON_CONNECTION_FAULT,
            requestId: meta.request.id
          })
        }

        // retry logic
        if (meta.attempts < maxRetries) {
          meta.attempts++
          debug(`Retrying request, there are still ${maxRetries - meta.attempts} attempts`, params)
          request = makeRequest()
          return
        }

        const error = err instanceof TimeoutError
          ? err
          : new ConnectionError(err.message, result)

        if (err.name === 'TimeoutError') {
          err.meta = result
        }

        this.emit('response', error, result)
        return callback(error, result)
      }

      const { statusCode, headers } = response
      result.statusCode = statusCode
      result.headers = headers
      if (headers['warning'] != null) {
        result.warnings = result.warnings || []
        // split the string over the commas not inside quotes
        result.warnings.push.apply(result.warnings, headers['warning'].split(/(?!\B"[^"]*),(?![^"]*"\B)/))
      }

      if (options.asStream === true) {
        result.body = response
        this.emit('response', null, result)
        callback(null, result)
        return
      }

      var payload = ''
      // collect the payload
      response.setEncoding('utf8')
      response.on('data', chunk => { payload += chunk })
      /* istanbul ignore next */
      response.on('error', err => {
        const error = new ConnectionError(err.message, result)
        this.emit('response', error, result)
        callback(error, result)
      })
      response.on('end', () => {
        const isHead = params.method === 'HEAD'
        // we should attempt the payload deserialization only if:
        //    - a `content-type` is defined and is equal to `application/json`
        //    - the request is not a HEAD request
        //    - the payload is not an empty string
        if (headers['content-type'] != null &&
            headers['content-type'].indexOf('application/json') > -1 &&
            isHead === false &&
            payload !== ''
        ) {
          try {
            result.body = this.serializer.deserialize(payload)
          } catch (err) {
            this.emit('response', err, result)
            return callback(err, result)
          }
        } else {
          // cast to boolean if the request method was HEAD
          result.body = isHead === true ? true : payload
        }

        // we should ignore the statusCode if the user has configured the `ignore` field with
        // the statusCode we just got or if the request method is HEAD and the statusCode is 404
        const ignoreStatusCode = (Array.isArray(options.ignore) && options.ignore.indexOf(statusCode) > -1) ||
          (isHead === true && statusCode === 404)

        if (ignoreStatusCode === false &&
           (statusCode === 502 || statusCode === 503 || statusCode === 504)) {
          // if the statusCode is 502/3/4 we should run our retry strategy
          // and mark the connection as dead
          this.connectionPool.markDead(meta.connection!)
          // retry logic (we shoukd not retry on "429 - Too Many Requests")
          if (meta.attempts < maxRetries && statusCode !== 429) {
            meta.attempts++
            debug(`Retrying request, there are still ${maxRetries - meta.attempts} attempts`, params)
            request = makeRequest()
            return
          }
        } else {
          // everything has worked as expected, let's mark
          // the connection as alive (or confirm it)
          this.connectionPool.markAlive(meta.connection!)
        }

        if (ignoreStatusCode === false && statusCode >= 400) {
          const error = new ResponseError(result)
          this.emit('response', error, result)
          callback(error, result)
        } else {
          // cast to boolean if the request method was HEAD
          if (isHead === true && statusCode === 404) {
            result.body = false
          }
          this.emit('response', null, result)
          callback(null, result)
        }
      })
    }

    request = makeRequest()

    return {
      abort: () => {
        meta.aborted = true
        request.abort()
        debug('Aborting request', params)
      }
    }
  }

  getConnection (opts): Connection | null {
    const now = Date.now()
    if (this._sniffEnabled === true && now > this._nextSniff) {
      this.sniff({ reason: Transport.sniffReasons.SNIFF_INTERVAL, requestId: opts.requestId })
    }
    return this.connectionPool.getConnection({
      filter: this.nodeFilter,
      selector: this.nodeSelector,
      requestId: opts.requestId,
      name: this.name,
      now
    })
  }

  sniff (opts, callback = sniffNoop) {
    if (this._isSniffing === true) return
    this._isSniffing = true
    debug('Started sniffing request')

    if (typeof opts === 'function') {
      callback = opts
      opts = { reason: Transport.sniffReasons.DEFAULT }
    }

    const { reason } = opts

    const request = {
      method: 'GET',
      path: this.sniffEndpoint
    }

    this.request(request, { id: opts.requestId }, (err, result) => {
      this._isSniffing = false
      if (this._sniffEnabled === true) {
        this._nextSniff = Date.now() + this.sniffInterval
      }

      if (err != null) {
        debug('Sniffing errored', err)
        result.meta.sniff = { hosts: [], reason }
        this.emit('sniff', err, result)
        return callback(err, null)
      }

      debug('Sniffing ended successfully', result.body)
      const protocol = result.meta.connection!.url.protocol || 'http:'
      const hosts = this.connectionPool.nodesToHost(result.body.nodes, protocol)
      this.connectionPool.update(hosts)

      result.meta.sniff = { hosts, reason }
      this.emit('sniff', null, result)
      callback(null, hosts)
    })
  }
}

Transport.sniffReasons = {
  SNIFF_ON_START: 'sniff-on-start',
  SNIFF_INTERVAL: 'sniff-interval',
  SNIFF_ON_CONNECTION_FAULT: 'sniff-on-connection-fault',
  // TODO: find a better name
  DEFAULT: 'default'
}

function toMs (time: string | number): number {
  if (typeof time === 'string') {
    return ms(time)
  }
  return time
}

function shouldSerialize (obj): obj is Record<string, any> {
  return typeof obj !== 'string' &&
         typeof obj.pipe !== 'function' &&
         Buffer.isBuffer(obj) === false
}

function isStream (obj): obj is ReadableStream {
  return obj && typeof obj.pipe === 'function'
}

function defaultNodeFilter (node) {
  // avoid master only nodes
  if (node.roles.master === true &&
      node.roles.data === false &&
      node.roles.ingest === false) {
    return false
  }
  return true
}

function roundRobinSelector () {
  var current = -1
  return function _roundRobinSelector (connections) {
    if (++current >= connections.length) {
      current = 0
    }
    return connections[current]
  }
}

function randomSelector (connections) {
  const index = Math.floor(Math.random() * connections.length)
  return connections[index]
}

function generateRequestId () {
  var maxInt = 2147483647
  var nextReqId = 0
  return function genReqId (params, options) {
    return (nextReqId = (nextReqId + 1) & maxInt)
  }
}

export default Transport
// TODO: once the test are ported to ts, renable this line
export const internals = { defaultNodeFilter, roundRobinSelector, randomSelector, generateRequestId }
// @ts-ignore
// module.exports = exports.default
// @ts-ignore
// module.exports.internals = { defaultNodeFilter, roundRobinSelector, randomSelector, generateRequestId }
