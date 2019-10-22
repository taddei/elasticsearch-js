// Licensed to Elasticsearch B.V under one or more agreements.
// Elasticsearch B.V licenses this file to you under the Apache 2.0 License.
// See the LICENSE file in the project root for more information

'use strict'

import { test } from 'tap'
import { internals } from '../../src/Transport'
const { randomSelector, roundRobinSelector } = internals

test('RoundRobinSelector', (t: any) => {
  const selector = roundRobinSelector()
  const arr = [0, 1, 2, 3, 4, 5]

  t.plan(arr.length + 1)
  for (var i = 0; i <= arr.length; i++) {
    t.strictEqual(
      selector(arr),
      i === arr.length ? arr[0] : arr[i]
    )
  }
})

test('RandomSelector', (t: any) => {
  t.plan(1)
  const arr = [0, 1, 2, 3, 4, 5]
  t.type(randomSelector(arr), 'number')
})
