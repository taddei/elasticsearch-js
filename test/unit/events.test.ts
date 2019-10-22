// Licensed to Elasticsearch B.V under one or more agreements.
// Elasticsearch B.V licenses this file to you under the Apache 2.0 License.
// See the LICENSE file in the project root for more information

'use strict'

import { test } from 'tap'
import { Client, events, errors } from '../../src'
import { connection } from '../utils'

const { MockConnection, MockConnectionTimeout } = connection
const { TimeoutError } = errors

test('Should emit a request event when a request is performed', (t: any) => {
  t.plan(3)

  const client = new Client({
    node: 'http://localhost:9200',
    Connection: MockConnection
  })

  client.on(events.REQUEST, (err, request) => {
    t.error(err)
    t.match(request, {
      body: null,
      statusCode: null,
      headers: null,
      warnings: null,
      meta: {
        context: null,
        name: 'elasticsearch-js',
        request: {
          params: {
            method: 'GET',
            path: '/test/_search',
            body: undefined,
            querystring: 'q=foo%3Abar',
            headers: {
              'Content-Type': 'application/json'
            }
          },
          options: {},
          id: 1
        },
        connection: {
          id: 'http://localhost:9200'
        },
        attempts: 0,
        aborted: false
      }
    })
  })

  client.search({
    index: 'test',
    q: 'foo:bar'
  }, (err, result) => {
    t.error(err)
  })
})

test('Should emit a response event in case of a successful response', (t: any) => {
  t.plan(3)

  const client = new Client({
    node: 'http://localhost:9200',
    Connection: MockConnection
  })

  client.on(events.RESPONSE, (err, request) => {
    t.error(err)
    t.match(request, {
      body: { hello: 'world' },
      statusCode: 200,
      headers: {
        'content-type': 'application/json;utf=8',
        connection: 'keep-alive'
      },
      warnings: null,
      meta: {
        context: null,
        name: 'elasticsearch-js',
        request: {
          params: {
            method: 'GET',
            path: '/test/_search',
            body: undefined,
            querystring: 'q=foo%3Abar',
            headers: {
              'Content-Type': 'application/json'
            }
          },
          options: {},
          id: 1
        },
        connection: {
          id: 'http://localhost:9200'
        },
        attempts: 0,
        aborted: false
      }
    })
  })

  client.search({
    index: 'test',
    q: 'foo:bar'
  }, (err, result) => {
    t.error(err)
  })
})

test('Should emit a response event with the error set', (t: any) => {
  t.plan(3)

  const client = new Client({
    node: 'http://localhost:9200',
    Connection: MockConnectionTimeout,
    maxRetries: 0
  })

  client.on(events.RESPONSE, (err, request) => {
    t.ok(err instanceof TimeoutError)
    t.match(request, {
      body: null,
      statusCode: null,
      headers: null,
      warnings: null,
      meta: {
        context: null,
        name: 'elasticsearch-js',
        request: {
          params: {
            method: 'GET',
            path: '/test/_search',
            body: undefined,
            querystring: 'q=foo%3Abar',
            headers: {
              'Content-Type': 'application/json'
            }
          },
          options: {
            requestTimeout: 500
          },
          id: 1
        },
        connection: {
          id: 'http://localhost:9200'
        },
        attempts: 0,
        aborted: false
      }
    })
  })

  client.search({
    index: 'test',
    q: 'foo:bar'
  }, {
    requestTimeout: 500
  }, (err, result) => {
    t.ok(err instanceof TimeoutError)
  })
})
