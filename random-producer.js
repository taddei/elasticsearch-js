'use strict'

const { Readable } = require('stream')
const { Client } = require('./')
const client = new Client({ node: 'http://localhost:9200' })

const b = client.helpers.bulk({
  datasource: buildDatasource(10),
  flushBytes: 'auto',
  onDocument (doc) {
    return {
      index: { _index: 'test' }
    }
  }
})

b.then(console.log).catch(console.log)

function buildDatasource (interval) {
  const stream = new Readable({
    objectMode: true,
    read (size) {}
  })

  setInterval(() => {
    const rand = Math.random()
    if (rand < 0.3) {
      stream.push({ you_know: 'for search' })
    } else if (rand >= 0.3 && rand < 0.7) {
      stream.push({
        first: 'second',
        third: 'fourth'
      })
    } else {
      stream.push({
        hello: 'world',
        ciao: 'mondo',
        hola: 'mundo',
        hallo: 'welt'
      })
    }
  }, interval)

  return stream
}
