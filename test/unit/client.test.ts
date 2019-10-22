// Licensed to Elasticsearch B.V under one or more agreements.
// Elasticsearch B.V licenses this file to you under the Apache 2.0 License.
// See the LICENSE file in the project root for more information

'use strict'

import { test } from 'tap'
import { URL } from 'url'
import { Client, ConnectionPool, Transport, errors, ApiResponse } from '../../src'
import { TransportRequestParams, TransportRequestOptions } from '../../src/Transport'
import { CloudConnectionPool } from '../../src/pool'
import { buildServer } from '../utils'

const { ElasticsearchClientError } = errors

test('Configure host', (t: any) => {
  t.test('Single string', (t: any) => {
    const client = new Client({
      node: 'http://localhost:9200'
    })
    const pool = client.connectionPool
    t.match(pool.connections.find(c => c.id === 'http://localhost:9200/'), {
      url: new URL('http://localhost:9200'),
      id: 'http://localhost:9200/',
      ssl: null,
      deadCount: 0,
      resurrectTimeout: 0,
      roles: {
        master: true,
        data: true,
        ingest: true,
        ml: false
      }
    })
    t.end()
  })

  t.test('Array of strings', (t: any) => {
    const client = new Client({
      nodes: ['http://localhost:9200', 'http://localhost:9201']
    })
    const pool = client.connectionPool
    t.match(pool.connections.find(c => c.id === 'http://localhost:9200/'), {
      url: new URL('http://localhost:9200'),
      id: 'http://localhost:9200/',
      ssl: null,
      deadCount: 0,
      resurrectTimeout: 0,
      roles: {
        master: true,
        data: true,
        ingest: true,
        ml: false
      }
    })
    t.match(pool.connections.find(c => c.id === 'http://localhost:9201/'), {
      url: new URL('http://localhost:9201'),
      id: 'http://localhost:9201/',
      ssl: null,
      deadCount: 0,
      resurrectTimeout: 0,
      roles: {
        master: true,
        data: true,
        ingest: true,
        ml: false
      }
    })

    t.end()
  })

  t.test('Single object', (t: any) => {
    const client = new Client({
      node: {
        url: new URL('http://localhost:9200'),
        id: 'node',
        roles: {
          master: true,
          data: false,
          ingest: false
        },
        ssl: { timeout: 42 }
      }
    })
    const pool = client.connectionPool
    t.match(pool.connections.find(c => c.id === 'node'), {
      url: new URL('http://localhost:9200'),
      id: 'node',
      ssl: { timeout: 42 },
      deadCount: 0,
      resurrectTimeout: 0
    })

    t.deepEqual(pool.connections.find(c => c.id === 'node').roles, {
      master: true,
      data: false,
      ingest: false,
      ml: false
    })

    t.end()
  })

  t.test('Array of objects', (t: any) => {
    const client = new Client({
      nodes: [{
        url: new URL('http://localhost:9200'),
        id: 'node1',
        roles: {
          master: true,
          data: false,
          ingest: false
        },
        ssl: { timeout: 42 }
      }, {
        url: new URL('http://localhost:9200'),
        id: 'node2',
        roles: {
          master: false,
          data: true,
          ingest: false
        },
        ssl: { timeout: 42 }
      }]
    })
    const pool = client.connectionPool
    t.match(pool.connections.find(c => c.id === 'node1'), {
      url: new URL('http://localhost:9200'),
      id: 'node1',
      ssl: { timeout: 42 },
      deadCount: 0,
      resurrectTimeout: 0
    })

    t.deepEqual(pool.connections.find(c => c.id === 'node1').roles, {
      master: true,
      data: false,
      ingest: false,
      ml: false
    })

    t.match(pool.connections.find(c => c.id === 'node2'), {
      url: new URL('http://localhost:9200'),
      id: 'node2',
      ssl: 'ssl',
      deadCount: 0,
      resurrectTimeout: 0
    })

    t.deepEqual(pool.connections.find(c => c.id === 'node2').roles, {
      master: false,
      data: true,
      ingest: false,
      ml: false
    })

    t.end()
  })

  t.test('Custom headers', (t: any) => {
    const client = new Client({
      node: {
        url: new URL('http://localhost:9200'),
        headers: { 'x-foo': 'bar' },
        id: 'node'
      }
    })
    const pool = client.connectionPool
    t.match(pool.connections.find(c => c.id === 'node'), {
      url: new URL('http://localhost:9200'),
      headers: { 'x-foo': 'bar' }
    })
    t.end()
  })

  t.test('Missing node conf', (t: any) => {
    try {
      new Client() // eslint-disable-line
      t.fail('Should fail')
    } catch (err) {
      t.ok(err)
    }
    t.end()
  })

  t.end()
})

test('Authentication', (t: any) => {
  t.test('Basic', (t: any) => {
    t.test('Node with basic auth data in the url', (t: any) => {
      t.plan(3)

      function handler (req, res) {
        t.match(req.headers, {
          authorization: 'Basic Zm9vOmJhcg=='
        })
        res.setHeader('Content-Type', 'application/json;utf=8')
        res.end(JSON.stringify({ hello: 'world' }))
      }

      buildServer(handler, ({ port }, server) => {
        const client = new Client({
          node: `http://foo:bar@localhost:${port}`
        })

        client.info((err, { body }) => {
          t.error(err)
          t.deepEqual(body, { hello: 'world' })
          server.stop()
        })
      })
    })

    t.test('Node with basic auth data in the url (array of nodes)', (t: any) => {
      t.plan(3)

      function handler (req, res) {
        t.match(req.headers, {
          authorization: 'Basic Zm9vOmJhcg=='
        })
        res.setHeader('Content-Type', 'application/json;utf=8')
        res.end(JSON.stringify({ hello: 'world' }))
      }

      buildServer(handler, ({ port }, server) => {
        const client = new Client({
          nodes: [`http://foo:bar@localhost:${port}`]
        })

        client.info((err, { body }) => {
          t.error(err)
          t.deepEqual(body, { hello: 'world' })
          server.stop()
        })
      })
    })

    t.test('Node with basic auth data in the options', (t: any) => {
      t.plan(3)

      function handler (req, res) {
        t.match(req.headers, {
          authorization: 'Basic Zm9vOmJhcg=='
        })
        res.setHeader('Content-Type', 'application/json;utf=8')
        res.end(JSON.stringify({ hello: 'world' }))
      }

      buildServer(handler, ({ port }, server) => {
        const client = new Client({
          node: `http://localhost:${port}`,
          auth: {
            username: 'foo',
            password: 'bar'
          }
        })

        client.info((err, { body }) => {
          t.error(err)
          t.deepEqual(body, { hello: 'world' })
          server.stop()
        })
      })
    })

    t.test('Custom basic authentication per request', (t: any) => {
      t.plan(6)

      var first = true
      function handler (req, res) {
        t.match(req.headers, {
          authorization: first ? 'hello' : 'Basic Zm9vOmJhcg=='
        })
        res.setHeader('Content-Type', 'application/json;utf=8')
        res.end(JSON.stringify({ hello: 'world' }))
      }

      buildServer(handler, ({ port }, server) => {
        const client = new Client({
          node: `http://foo:bar@localhost:${port}`
        })

        client.info({}, {
          headers: {
            authorization: 'hello'
          }
        }, (err, { body }) => {
          t.error(err)
          t.deepEqual(body, { hello: 'world' })
          first = false

          client.info((err, { body }) => {
            t.error(err)
            t.deepEqual(body, { hello: 'world' })
            server.stop()
          })
        })
      })
    })

    t.test('Override default basic authentication per request', (t: any) => {
      t.plan(6)

      var first = true
      function handler (req, res) {
        t.match(req.headers, {
          authorization: first ? 'hello' : 'Basic Zm9vOmJhcg=='
        })
        res.setHeader('Content-Type', 'application/json;utf=8')
        res.end(JSON.stringify({ hello: 'world' }))
      }

      buildServer(handler, ({ port }, server) => {
        const client = new Client({
          node: `http://localhost:${port}`,
          auth: {
            username: 'foo',
            password: 'bar'
          }
        })

        client.info({}, {
          headers: {
            authorization: 'hello'
          }
        }, (err, { body }) => {
          t.error(err)
          t.deepEqual(body, { hello: 'world' })
          first = false

          client.info((err, { body }) => {
            t.error(err)
            t.deepEqual(body, { hello: 'world' })
            server.stop()
          })
        })
      })
    })

    t.end()
  })

  t.test('ApiKey', (t: any) => {
    t.test('Node with ApiKey auth data in the options as string', (t: any) => {
      t.plan(3)

      function handler (req, res) {
        t.match(req.headers, {
          authorization: 'ApiKey Zm9vOmJhcg=='
        })
        res.setHeader('Content-Type', 'application/json;utf=8')
        res.end(JSON.stringify({ hello: 'world' }))
      }

      buildServer(handler, ({ port }, server) => {
        const client = new Client({
          node: `http://localhost:${port}`,
          auth: {
            apiKey: 'Zm9vOmJhcg=='
          }
        })

        client.info((err, { body }) => {
          t.error(err)
          t.deepEqual(body, { hello: 'world' })
          server.stop()
        })
      })
    })

    t.test('Node with ApiKey auth data in the options as object', (t: any) => {
      t.plan(3)

      function handler (req, res) {
        t.match(req.headers, {
          authorization: 'ApiKey Zm9vOmJhcg=='
        })
        res.setHeader('Content-Type', 'application/json;utf=8')
        res.end(JSON.stringify({ hello: 'world' }))
      }

      buildServer(handler, ({ port }, server) => {
        const client = new Client({
          node: `http://localhost:${port}`,
          auth: {
            apiKey: { id: 'foo', api_key: 'bar' }
          }
        })

        client.info((err, { body }) => {
          t.error(err)
          t.deepEqual(body, { hello: 'world' })
          server.stop()
        })
      })
    })

    t.test('Custom ApiKey authentication per request', (t: any) => {
      t.plan(6)

      var first = true
      function handler (req, res) {
        t.match(req.headers, {
          authorization: first ? 'ApiKey Zm9vOmJhcg==' : 'Basic Zm9vOmJhcg=='
        })
        res.setHeader('Content-Type', 'application/json;utf=8')
        res.end(JSON.stringify({ hello: 'world' }))
      }

      buildServer(handler, ({ port }, server) => {
        const client = new Client({
          node: `http://foo:bar@localhost:${port}`
        })

        client.info({}, {
          headers: {
            authorization: 'ApiKey Zm9vOmJhcg=='
          }
        }, (err, { body }) => {
          t.error(err)
          t.deepEqual(body, { hello: 'world' })
          first = false

          client.info((err, { body }) => {
            t.error(err)
            t.deepEqual(body, { hello: 'world' })
            server.stop()
          })
        })
      })
    })

    t.test('Override default ApiKey authentication per request', (t: any) => {
      t.plan(6)

      var first = true
      function handler (req, res) {
        t.match(req.headers, {
          authorization: first ? 'hello' : 'ApiKey Zm9vOmJhcg=='
        })
        res.setHeader('Content-Type', 'application/json;utf=8')
        res.end(JSON.stringify({ hello: 'world' }))
      }

      buildServer(handler, ({ port }, server) => {
        const client = new Client({
          node: `http://localhost:${port}`,
          auth: {
            apiKey: 'Zm9vOmJhcg=='
          }
        })

        client.info({}, {
          headers: {
            authorization: 'hello'
          }
        }, (err, { body }) => {
          t.error(err)
          t.deepEqual(body, { hello: 'world' })
          first = false

          client.info((err, { body }) => {
            t.error(err)
            t.deepEqual(body, { hello: 'world' })
            server.stop()
          })
        })
      })
    })

    t.end()
  })

  t.end()
})

test('Custom headers per request', (t: any) => {
  t.plan(3)

  function handler (req, res) {
    t.match(req.headers, {
      'x-foo': 'bar',
      'x-baz': 'faz'
    })
    res.setHeader('Content-Type', 'application/json;utf=8')
    res.end(JSON.stringify({ hello: 'world' }))
  }

  buildServer(handler, ({ port }, server) => {
    const client = new Client({
      node: `http://foo:bar@localhost:${port}`
    })

    client.info({}, {
      headers: {
        'x-foo': 'bar',
        'x-baz': 'faz'
      }
    }, (err, { body }) => {
      t.error(err)
      t.deepEqual(body, { hello: 'world' })
      server.stop()
    })
  })
})

test('Client close', (t: any) => {
  t.plan(2)

  class MyConnectionPool extends ConnectionPool {
    empty (callback) {
      t.ok('called')
      super.empty(callback)
    }
  }

  const client = new Client({
    node: 'http://localhost:9200',
    ConnectionPool: MyConnectionPool
  })

  client.close(() => t.pass('Closed'))
})

test('Client close (promise)', (t: any) => {
  t.plan(2)

  class MyConnectionPool extends ConnectionPool {
    empty (callback) {
      t.ok('called')
      super.empty(callback)
    }
  }

  const client = new Client({
    node: 'http://localhost:9200',
    ConnectionPool: MyConnectionPool
  })

  client.close()
    .then(() => t.pass('Closed'))
})

test('Extend client APIs', (t: any) => {
  t.test('Extend a single method', (t: any) => {
    t.plan(5)

    const client = new Client({ node: 'http://localhost:9200' })
    client.extend('method', ({ makeRequest, result, ConfigurationError }) => {
      t.type(makeRequest, 'function')
      // @ts-ignore
      t.true(new ConfigurationError() instanceof ElasticsearchClientError)
      t.deepEqual(result, {
        body: null,
        statusCode: null,
        headers: null,
        warnings: null
      })

      return (params, options) => {
        t.deepEqual(params, { you_know: 'for search' })
        t.deepEqual(options, { winter: 'is coming' })
      }
    })

    client.method(
      { you_know: 'for search' },
      { winter: 'is coming' }
    )
  })

  t.test('Create a namespace and a method', (t: any) => {
    t.plan(5)

    const client = new Client({ node: 'http://localhost:9200' })
    client.extend('namespace.method', ({ makeRequest, result, ConfigurationError }) => {
      t.type(makeRequest, 'function')
      // @ts-ignore
      t.true(new ConfigurationError() instanceof ElasticsearchClientError)
      t.deepEqual(result, {
        body: null,
        statusCode: null,
        headers: null,
        warnings: null
      })

      return (params, options) => {
        t.deepEqual(params, { you_know: 'for search' })
        t.deepEqual(options, { winter: 'is coming' })
      }
    })

    client.namespace.method(
      { you_know: 'for search' },
      { winter: 'is coming' }
    )
  })

  t.test('Create a namespace and multiple methods', (t: any) => {
    t.plan(10)

    const client = new Client({ node: 'http://localhost:9200' })
    client.extend('namespace.method1', ({ makeRequest, result, ConfigurationError }) => {
      t.type(makeRequest, 'function')
      // @ts-ignore
      t.true(new ConfigurationError() instanceof ElasticsearchClientError)
      t.deepEqual(result, {
        body: null,
        statusCode: null,
        headers: null,
        warnings: null
      })

      return (params, options) => {
        t.deepEqual(params, { you_know: 'for search' })
        t.deepEqual(options, { winter: 'is coming' })
      }
    })

    client.extend('namespace.method2', ({ makeRequest, result, ConfigurationError }) => {
      t.type(makeRequest, 'function')
      // @ts-ignore
      t.true(new ConfigurationError() instanceof ElasticsearchClientError)
      t.deepEqual(result, {
        body: null,
        statusCode: null,
        headers: null,
        warnings: null
      })

      return (params, options) => {
        t.deepEqual(params, { you_know: 'for search' })
        t.deepEqual(options, { winter: 'is coming' })
      }
    })

    client.namespace.method1(
      { you_know: 'for search' },
      { winter: 'is coming' }
    )

    client.namespace.method2(
      { you_know: 'for search' },
      { winter: 'is coming' }
    )
  })

  t.test('Cannot override an existing method', (t: any) => {
    t.plan(1)

    const client = new Client({ node: 'http://localhost:9200' })
    try {
      client.extend('index', () => {})
      t.fail('Should throw')
    } catch (err) {
      t.is(err.message, 'The method "index" already exists')
    }
  })

  t.test('Cannot override an existing namespace and method', (t: any) => {
    t.plan(1)

    const client = new Client({ node: 'http://localhost:9200' })
    try {
      client.extend('indices.delete', () => {})
      t.fail('Should throw')
    } catch (err) {
      t.is(err.message, 'The method "delete" already exists on namespace "indices"')
    }
  })

  t.test('Can override an existing method with { force: true }', (t: any) => {
    t.plan(1)

    const client = new Client({ node: 'http://localhost:9200' })
    try {
      client.extend('index', { force: true }, () => t.pass('Called'))
    } catch (err) {
      t.fail('Should not throw')
    }
  })

  t.test('Can override an existing namespace and method with { force: true }', (t: any) => {
    t.plan(1)

    const client = new Client({ node: 'http://localhost:9200' })
    try {
      client.extend('indices.delete', { force: true }, () => t.pass('Called'))
    } catch (err) {
      t.fail('Should not throw')
    }
  })

  t.test('Should call the transport.request method', (t: any) => {
    t.plan(2)

    class MyTransport extends Transport {
      // @ts-ignore
      request (params: TransportRequestParams, options: TransportRequestOptions): void{
        t.deepEqual(params, { you_know: 'for search' })
        t.deepEqual(options, { winter: 'is coming' })
      }
    }

    const client = new Client({
      node: 'http://localhost:9200',
      // @ts-ignore
      Transport: MyTransport
    })
    client.extend('method', ({ makeRequest, result, ConfigurationError }) => {
      return (params, options) => makeRequest(params, options)
    })

    client.method(
      { you_know: 'for search' },
      { winter: 'is coming' }
    )
  })

  t.test('Should support callbacks', (t: any) => {
    t.plan(2)

    const client = new Client({ node: 'http://localhost:9200' })
    client.extend('method', ({ makeRequest, result, ConfigurationError }) => {
      return (params, options, callback) => {
        callback(null, { hello: 'world' })
      }
    })

    client.method(
      { you_know: 'for search' },
      { winter: 'is coming' },
      (err, res) => {
        t.error(err)
        t.deepEqual(res, { hello: 'world' })
      }
    )
  })

  t.test('Should support promises', (t: any) => {
    t.plan(1)

    const client = new Client({ node: 'http://localhost:9200' })
    client.extend('method', ({ makeRequest, result, ConfigurationError }) => {
      return (params, options) => {
        return new Promise((resolve, reject) => {
          resolve({ hello: 'world' })
        })
      }
    })

    client
      .method(
        { you_know: 'for search' },
        { winter: 'is coming' }
      )
      .then(res => t.deepEqual(res, { hello: 'world' }))
      .catch(err => t.fail(err))
  })

  t.end()
})

test('Elastic cloud config', (t: any) => {
  t.test('Basic', (t: any) => {
    t.plan(5)
    const client = new Client({
      cloud: {
        // 'localhost$abcd$efgh'
        id: 'name:bG9jYWxob3N0JGFiY2QkZWZnaA==',
        username: 'elastic',
        password: 'changeme'
      }
    })

    const pool = client.connectionPool
    t.ok(pool instanceof CloudConnectionPool)
    t.match(pool.connections.find(c => c.id === 'https://abcd.localhost/'), {
      url: new URL('https://elastic:changeme@abcd.localhost'),
      id: 'https://abcd.localhost/',
      headers: {
        authorization: 'Basic ' + Buffer.from('elastic:changeme').toString('base64')
      },
      ssl: { secureProtocol: 'TLSv1_2_method' },
      deadCount: 0,
      resurrectTimeout: 0,
      roles: {
        master: true,
        data: true,
        ingest: true,
        ml: false
      }
    })

    t.strictEqual(client.transport.compression, 'gzip')
    t.strictEqual(client.transport.suggestCompression, true)
    t.deepEqual(pool._ssl, { secureProtocol: 'TLSv1_2_method' })
  })

  t.test('Auth as separate option', (t: any) => {
    t.plan(5)
    const client = new Client({
      cloud: {
        // 'localhost$abcd$efgh'
        id: 'name:bG9jYWxob3N0JGFiY2QkZWZnaA=='
      },
      auth: {
        username: 'elastic',
        password: 'changeme'
      }
    })

    const pool = client.connectionPool
    t.ok(pool instanceof CloudConnectionPool)
    t.match(pool.connections.find(c => c.id === 'https://abcd.localhost/'), {
      url: new URL('https://elastic:changeme@abcd.localhost'),
      id: 'https://abcd.localhost/',
      headers: {
        authorization: 'Basic ' + Buffer.from('elastic:changeme').toString('base64')
      },
      ssl: { secureProtocol: 'TLSv1_2_method' },
      deadCount: 0,
      resurrectTimeout: 0,
      roles: {
        master: true,
        data: true,
        ingest: true,
        ml: false
      }
    })

    t.strictEqual(client.transport.compression, 'gzip')
    t.strictEqual(client.transport.suggestCompression, true)
    t.deepEqual(pool._ssl, { secureProtocol: 'TLSv1_2_method' })
  })

  t.test('Override default options', (t: any) => {
    t.plan(4)
    const client = new Client({
      cloud: {
        // 'localhost$abcd$efgh'
        id: 'name:bG9jYWxob3N0JGFiY2QkZWZnaA==',
        username: 'elastic',
        password: 'changeme'
      },
      // @ts-ignore
      compression: false,
      suggestCompression: false,
      ssl: {
        secureProtocol: 'TLSv1_1_method'
      }
    })

    t.ok(client.connectionPool instanceof CloudConnectionPool)
    t.strictEqual(client.transport.compression, false)
    t.strictEqual(client.transport.suggestCompression, false)
    t.deepEqual(client.connectionPool._ssl, { secureProtocol: 'TLSv1_1_method' })
  })

  t.end()
})
