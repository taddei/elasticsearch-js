// Licensed to Elasticsearch B.V under one or more agreements.
// Elasticsearch B.V licenses this file to you under the Apache 2.0 License.
// See the LICENSE file in the project root for more information

'use strict'

import Debug from 'debug'
import stoppable from 'stoppable'

const debug = Debug('elas-test')

// allow self signed certificates for testing purposes
// @ts-ignore
process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0

const { readFileSync } = require('fs')
const { join } = require('path')
const https = require('https')
const http = require('http')

const secureOpts = {
  key: readFileSync(join(__dirname, '..', 'fixtures', 'https.key'), 'utf8'),
  cert: readFileSync(join(__dirname, '..', 'fixtures', 'https.cert'), 'utf8')
}

var id = 0
function buildServer (handler, cb)
function buildServer (handler, opts, cb)
function buildServer (handler, opts?, cb?) {
  const serverId = id++
  debug(`Booting server '${serverId}'`)
  if (cb == null) {
    cb = opts
    opts = {}
  }

  const server = opts.secure
    ? stoppable(https.createServer(secureOpts))
    : stoppable(http.createServer())

  server.on('request', handler)
  server.on('error', err => {
    console.log('http server error', err)
    process.exit(1)
  })
  server.listen(0, () => {
    const port = server.address().port
    debug(`Server '${serverId}' booted on port ${port}`)
    cb(Object.assign({}, secureOpts, { port }), server)
  })
}

export default buildServer
