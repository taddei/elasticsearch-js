// Licensed to Elasticsearch B.V under one or more agreements.
// Elasticsearch B.V licenses this file to you under the Apache 2.0 License.
// See the LICENSE file in the project root for more information

'use strict'

const debug = require('debug')('elasticsearch')
const os = require('os')
const { gzip, createGzip } = require('zlib')
const ms = require('ms')
const {
  ConnectionError,
  RequestAbortedError,
  NoLivingConnectionsError,
  ResponseError,
  ConfigurationError
} = require('./errors')

const noop = () => {}

const clientVersion = require('../package.json').version
const userAgent = `elasticsearch-js/${clientVersion} (${os.platform()} ${os.release()}-${os.arch()}; Node.js ${process.version})`

class Transport {
  constructor (opts) {
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
    this.headers = Object.assign({},
      { 'user-agent': userAgent },
      opts.suggestCompression === true ? { 'accept-encoding': 'gzip,deflate' } : null,
      lowerCaseHeaders(opts.headers)
    )
    this.sniffInterval = opts.sniffInterval
    this.sniffOnConnectionFault = opts.sniffOnConnectionFault
    this.sniffEndpoint = opts.sniffEndpoint
    this.generateRequestId = opts.generateRequestId || generateRequestId()
    this.name = opts.name
    this.opaqueIdPrefix = opts.opaqueIdPrefix

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

    this._sniffEnabled = typeof this.sniffInterval === 'number'
    this._nextSniff = this._sniffEnabled ? (Date.now() + this.sniffInterval) : 0
    this._isSniffing = false

    if (opts.sniffOnStart === true) {
      this.sniff({ reason: Transport.sniffReasons.SNIFF_ON_START })
    }
  }

  request (params, options, callback) {
    options = options || {}
    if (typeof options === 'function') {
      callback = options
      options = {}
    }
    var p = null

    // promises support
    if (callback === undefined) {
      let onFulfilled = null
      let onRejected = null
      p = new Promise((resolve, reject) => {
        onFulfilled = resolve
        onRejected = reject
      })
      callback = function callback (err, result) {
        err ? onRejected(err) : onFulfilled(result)
      }
    }

    const meta = {
      context: options.context || null,
      request: {
        params: null,
        options: null,
        id: options.id || this.generateRequestId(params, options)
      },
      name: this.name,
      connection: null,
      attempts: 0,
      aborted: false
    }

    const result = {
      body: null,
      statusCode: null,
      headers: null,
      warnings: options.warnings || null,
      meta
    }

    // We should not retry if we are sending a stream body, because we should store in memory
    // a copy of the stream to be able to send it again, but since we don't know in advance
    // the size of the stream, we risk to take too much memory.
    // Furthermore, copying everytime the stream is very a expensive operation.
    const maxRetries = isStream(params.body) ? 0 : options.maxRetries || this.maxRetries
    const compression = options.compression !== undefined ? options.compression : this.compression
    var request = { abort: noop }

    const makeRequest = () => {
      if (meta.aborted === true) {
        return callback(new RequestAbortedError(), result)
      }
      meta.connection = this.getConnection({ requestId: meta.request.id })
      if (meta.connection == null) {
        return callback(new NoLivingConnectionsError(), result)
      }
      this.emit('request', null, result)
      // perform the actual http request
      request = meta.connection.request(params, onResponse)
    }

    const onResponse = (err, response) => {
      if (err !== null) {
        if (err.name !== 'RequestAbortedError') {
          // if there is an error in the connection
          // let's mark the connection as dead
          this.connectionPool.markDead(meta.connection)

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
            makeRequest()
            return
          }
        }

        err.meta = result
        this.emit('response', err, result)
        return callback(err, result)
      }

      const { statusCode, headers } = response
      result.statusCode = statusCode
      result.headers = headers
      if (headers['warning'] !== undefined) {
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
        if (headers['content-type'] !== undefined &&
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
          this.connectionPool.markDead(meta.connection)
          // retry logic (we shoukd not retry on "429 - Too Many Requests")
          if (meta.attempts < maxRetries && statusCode !== 429) {
            meta.attempts++
            debug(`Retrying request, there are still ${maxRetries - meta.attempts} attempts`, params)
            makeRequest()
            return
          }
        } else {
          // everything has worked as expected, let's mark
          // the connection as alive (or confirm it)
          this.connectionPool.markAlive(meta.connection)
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

    const headers = Object.assign({}, this.headers, lowerCaseHeaders(options.headers))

    if (options.opaqueId !== undefined) {
      headers['x-opaque-id'] = this.opaqueIdPrefix !== null
        ? this.opaqueIdPrefix + options.opaqueId
        : options.opaqueId
    }

    // handle json body
    if (params.body != null) {
      if (shouldSerialize(params.body) === true) {
        try {
          params.body = this.serializer.serialize(params.body)
        } catch (err) {
          return callback(err, result)
        }
      }

      if (params.body !== '') {
        headers['content-type'] = headers['content-type'] || 'application/json'
      }

    // handle ndjson body
    } else if (params.bulkBody != null) {
      if (shouldSerialize(params.bulkBody) === true) {
        try {
          params.body = this.serializer.ndserialize(params.bulkBody)
        } catch (err) {
          return callback(err, result)
        }
      } else {
        params.body = params.bulkBody
      }
      if (params.body !== '') {
        headers['content-type'] = headers['content-type'] || 'application/x-ndjson'
      }
    }

    params.headers = headers
    // serializes the querystring
    if (options.querystring == null) {
      params.querystring = this.serializer.qserialize(params.querystring)
    } else {
      params.querystring = this.serializer.qserialize(
        Object.assign({}, params.querystring, options.querystring)
      )
    }

    // handles request timeout
    params.timeout = toMs(options.requestTimeout || this.requestTimeout)
    if (options.asStream === true) params.asStream = true
    meta.request.params = params
    meta.request.options = options

    // handle compression
    if (params.body !== '' && params.body != null) {
      if (isStream(params.body) === true) {
        if (compression === 'gzip') {
          params.headers['content-encoding'] = compression
          params.body = params.body.pipe(createGzip())
        }
        makeRequest()
      } else if (compression === 'gzip') {
        gzip(params.body, (err, buffer) => {
          /* istanbul ignore next */
          if (err) {
            return callback(err, result)
          }
          params.headers['content-encoding'] = compression
          params.headers['content-length'] = '' + Buffer.byteLength(buffer)
          params.body = buffer
          makeRequest()
        })
      } else {
        params.headers['content-length'] = '' + Buffer.byteLength(params.body)
        makeRequest()
      }
    } else {
      makeRequest()
    }

    return {
      then (onFulfilled, onRejected) {
        return p.then(onFulfilled, onRejected)
      },
      catch (onRejected) {
        return p.catch(onRejected)
      },
      abort () {
        meta.aborted = true
        request.abort()
        debug('Aborting request', params)
        return this
      }
    }
  }

  getConnection (opts) {
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

  sniff (opts, callback = noop) {
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
        return callback(err)
      }

      debug('Sniffing ended successfully', result.body)
      const protocol = result.meta.connection.url.protocol || /* istanbul ignore next */ 'http:'
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

function toMs (time) {
  if (typeof time === 'string') {
    return ms(time)
  }
  return time
}

function shouldSerialize (obj) {
  return typeof obj !== 'string' &&
         typeof obj.pipe !== 'function' &&
         Buffer.isBuffer(obj) === false
}

function isStream (obj) {
  return obj != null && typeof obj.pipe === 'function'
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

function lowerCaseHeaders (oldHeaders) {
  if (oldHeaders == null) return oldHeaders
  const newHeaders = {}
  for (const header in oldHeaders) {
    newHeaders[header.toLowerCase()] = oldHeaders[header]
  }
  return newHeaders
}

module.exports = Transport
module.exports.internals = {
  defaultNodeFilter,
  roundRobinSelector,
  randomSelector,
  generateRequestId,
  lowerCaseHeaders
}
