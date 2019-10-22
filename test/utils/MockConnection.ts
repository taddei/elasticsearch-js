// Licensed to Elasticsearch B.V under one or more agreements.
// Elasticsearch B.V licenses this file to you under the Apache 2.0 License.
// See the LICENSE file in the project root for more information

'use strict'

import { Connection } from '../../src'
import { TimeoutError } from '../../src/errors'
import intoStream from 'into-stream'

export class MockConnection extends Connection {
  request (params, callback) {
    var aborted = false
    const stream = intoStream(JSON.stringify({ hello: 'world' }))
    // @ts-ignore
    stream.statusCode = setStatusCode(params.path)
    // @ts-ignore
    stream.headers = {
      'content-type': 'application/json;utf=8',
      date: new Date().toISOString(),
      connection: 'keep-alive',
      'content-length': '17'
    }
    process.nextTick(() => {
      if (!aborted) {
        callback(null, stream)
      }
    })
    return {
      abort: () => { aborted = true }
    }
  }
}

export class MockConnectionTimeout extends Connection {
  request (params, callback) {
    var aborted = false
    process.nextTick(() => {
      if (!aborted) {
        callback(new TimeoutError('Request timed out', params), null)
      }
    })
    return {
      abort: () => { aborted = true }
    }
  }
}

export class MockConnectionError extends Connection {
  request (params, callback) {
    var aborted = false
    process.nextTick(() => {
      if (!aborted) {
        callback(new Error('Kaboom'), null)
      }
    })
    return {
      abort: () => { aborted = true }
    }
  }
}

export class MockConnectionSniff extends Connection {
  request (params, callback) {
    var aborted = false
    const sniffResult = {
      nodes: {
        'node-1': {
          http: {
            publish_address: 'localhost:9200'
          },
          roles: ['master', 'data', 'ingest']
        },
        'node-2': {
          http: {
            publish_address: 'localhost:9201'
          },
          roles: ['master', 'data', 'ingest']
        }
      }
    }
    const stream = intoStream(JSON.stringify(sniffResult))
    // @ts-ignore
    stream.statusCode = setStatusCode(params.path)
    // @ts-ignore
    stream.headers = {
      'content-type': 'application/json;utf=8',
      date: new Date().toISOString(),
      connection: 'keep-alive',
      'content-length': '205'
    }
    process.nextTick(() => {
      if (!aborted) {
        if (params.headers.timeout) {
          callback(new TimeoutError('Request timed out', params), null)
        } else {
          callback(null, stream)
        }
      }
    })
    return {
      abort: () => { aborted = true }
    }
  }
}
function setStatusCode (path) {
  const statusCode = Number(path.slice(1))
  if (Number.isInteger(statusCode)) {
    return statusCode
  }
  return 200
}
