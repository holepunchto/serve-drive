const test = require('brittle')
const { request, tmpServe, tmpHyperdrive, tmpLocaldrive } = require('./helpers/index.js')
const axios = require('axios')
const RAM = require('random-access-memory')
const Hyperdrive = require('hyperdrive')
const Corestore = require('corestore')

test('can get existing file from drive (default-drive pattern)', async function (t) {
  t.plan(2 * 3)

  for (const isHyper of [true, false]) {
    const drive = isHyper ? tmpHyperdrive(t) : tmpLocaldrive(t)
    await drive.put('/file.txt', 'Here')

    let released = 0
    const serve = tmpServe(t, {
      get: () => drive,
      release: () => released++
    })
    await serve.ready()

    const res = await request(serve, '/file.txt')
    t.is(res.status, 200)
    t.is(res.data, 'Here')
    t.is(released, 1)
  }
})

test('getLink handles different path formats', async function (t) {
  t.plan(5)

  const serve = tmpServe(t)
  await serve.ready()

  const base = `http://localhost:${serve.address().port}`

  const link1 = serve.getLink('myFile')
  const link2 = serve.getLink('/myFile')
  const link3 = serve.getLink('./myFile')
  const link4 = serve.getLink('/my//File')
  const link5 = serve.getLink('/myDir/myFile.txt')

  t.is(link1, link2)
  t.is(link1, link3)
  t.is(link1, `${base}/myFile`)
  t.is(link4, `${base}/my/File`)
  t.is(link5, `${base}/myDir/myFile.txt`)
})

test('getLink optional params', async function (t) {
  t.plan(4)

  const serve = tmpServe(t)
  await serve.ready()

  const base = `http://localhost:${serve.address().port}`
  const baseSecure = `https://localhost:${serve.address().port}`

  t.is(serve.getLink('/file.txt', { key: 'an-alias' }), `${base}/file.txt?key=an-alias`)
  t.is(serve.getLink('/file.txt', { version: 5 }), `${base}/file.txt?version=5`)
  t.is(serve.getLink('/file.txt', { key: 'an-alias', version: 5 }), `${base}/file.txt?key=an-alias&version=5`)
  t.is(serve.getLink('/file.txt', { https: true }), `${baseSecure}/file.txt`)
})

test('getLink reverse-proxy use case', async function (t) {
  t.plan(3)

  const serve = tmpServe(t)
  await serve.ready()

  t.is(serve.getLink('/file.txt', { host: 'www.mydrive.org' }), 'http://www.mydrive.org/file.txt')
  t.is(serve.getLink('/file.txt', { https: true, host: 'www.mydrive.org', key: 'myId' }), 'https://www.mydrive.org/file.txt?key=myId')
  t.is(serve.getLink('/file.txt', { https: true, host: 'www.mydrive.org:40000', version: 5 }), 'https://www.mydrive.org:40000/file.txt?version=5')
})

test('getLink encoding', async function (t) {
  t.plan(1)

  const serve = tmpServe(t)
  await serve.ready()

  t.is(serve.getLink('/file txt', { https: true, host: 'www.mydrive.org:40000', version: 5 }), 'https://www.mydrive.org:40000/file%20txt?version=5')
})

test('getLink with global address', async function (t) {
  t.plan(2)

  const a = tmpServe(t, { host: '0.0.0.0' })
  await a.ready()
  t.is(a.getLink('/file.txt'), 'http://localhost:' + a.address().port + '/file.txt')

  const b = tmpServe(t, { host: '::' })
  await b.ready()
  t.is(b.getLink('/file.txt'), 'http://localhost:' + b.address().port + '/file.txt')
})

test('emits request-error if unexpected error when getting entry', async function (t) {
  t.plan(2)

  const drive = tmpHyperdrive(t)
  await drive.close() // Will cause session closed

  const serve = tmpServe(t, { get: () => drive })

  let error = null
  serve.on('request-error', e => { error = e })
  await serve.ready()

  const res = await request(serve, '/whatever')
  t.is(res.status, 500)
  t.is(error.code, 'SESSION_CLOSED')
})

test('404 if file not found', async function (t) {
  t.plan(2 * 3)

  for (const isHyper of [true, false]) {
    const drive = isHyper ? tmpHyperdrive(t) : tmpLocaldrive(t)
    await drive.ready()

    let released = 0
    const serve = tmpServe(t, {
      get: () => drive,
      release: () => released++
    })
    await serve.ready()

    const res = await request(serve, '/nothing')
    t.is(res.status, 404)
    t.is(res.data, '')
    t.is(released, 1)
  }
})

test('checkout query param (hyperdrive)', async function (t) {
  t.plan(9)

  const drive = tmpHyperdrive(t)

  let released = 0
  const serve = tmpServe(t, {
    get: () => drive,
    release: () => t.pass(`Released drive ${++released} of 3`)
  })
  await serve.ready()

  await drive.put('/file.txt', 'a')

  const initialVersion = drive.version
  t.is(initialVersion, 2)

  await drive.put('/file.txt', 'b')

  const res1 = await request(serve, '/file.txt')
  t.is(res1.status, 200)
  t.is(res1.data, 'b')

  const res2 = await request(serve, '/file.txt', { version: initialVersion })
  t.is(res2.status, 200)
  t.is(res2.data, 'a')

  // Hangs until future version found
  await t.exception(axios.get(serve.getLink('/file.txt', { version: 100 }), { timeout: 500 }), /timeout/)
})

test('can handle a non-ready drive', async function (t) {
  t.plan(4)

  const store = new Corestore(RAM.reusable())
  const drive = new Hyperdrive(store.namespace('drive'))
  await drive.put('/file.txt', 'here')
  await drive.close()

  let released = 0
  const serve = tmpServe(t, {
    get: () => clone,
    release: () => released++
  })
  await serve.ready()

  const clone = new Hyperdrive(store.namespace('drive'), drive.key)
  t.is(clone.opened, false)

  const res = await request(serve, '/file.txt')
  t.is(res.status, 200)
  t.is(res.data, 'here')
  t.is(released, 1)
})

test('checkout query param ignored for local drive', async function (t) {
  t.plan(9)

  const drive = tmpLocaldrive(t)
  await drive.put('/file.txt', 'Here')
  await drive.put('/another.txt', 'Stuff')
  await drive.put('/file.txt', 'Else')

  let released = 0
  const serve = tmpServe(t, {
    get: () => drive,
    release: () => released++
  })
  await serve.ready()

  const res1 = await request(serve, '/file.txt')
  t.is(res1.status, 200)
  t.is(res1.data, 'Else')
  t.is(released, 1)

  const res2 = await request(serve, '/file.txt', { version: 2 })
  t.is(res2.status, 200)
  t.is(res2.data, 'Else')
  t.is(released, 2)

  const res3 = await request(serve, '/file.txt', { version: 100 })
  t.is(res3.status, 200)
  t.is(res3.data, 'Else')
  t.is(released, 3)
})

test('multiple drives', async function (t) {
  t.plan(4 * 3)

  const localdrive = tmpLocaldrive(t)
  const hyperdrive = tmpHyperdrive(t)

  await localdrive.put('/file.txt', 'a')
  await hyperdrive.put('/file.txt', 'b')

  const releases = {
    default: 0,
    [hyperdrive.key.toString('hex')]: 0
  }

  const serve = tmpServe(t, {
    get ({ key }) {
      if (key === null) return localdrive
      if (key.equals(hyperdrive.key)) return hyperdrive
      return null
    },
    release ({ key, drive }) {
      releases[key ? key.toString('hex') : 'default']++
    }
  })
  await serve.ready()

  const a = await request(serve, '/file.txt')
  t.is(a.status, 200)
  t.is(a.data, 'a')
  t.alike(releases, {
    default: 1,
    [hyperdrive.key.toString('hex')]: 0
  })

  const b = await request(serve, '/file.txt', { key: hyperdrive.id })
  t.is(b.status, 200)
  t.is(b.data, 'b')
  t.alike(releases, {
    default: 1,
    [hyperdrive.key.toString('hex')]: 1
  })

  const c = await request(serve, '/file.txt', { key: '178krw3n5xzot1rn8s6m1gjjbp1co6pfy7yfukmueh7qbxa58ryo' })
  t.is(c.status, 404)
  t.is(c.data, '')
  t.alike(releases, {
    default: 1,
    [hyperdrive.key.toString('hex')]: 1
  })

  const d = await request(serve, '/file.txt', { key: 'invalid-key' })
  t.is(d.status, 400)
  t.is(d.data, '')
  t.alike(releases, {
    default: 1,
    [hyperdrive.key.toString('hex')]: 1
  })
})

test('filter by using get hook', async function (t) {
  t.plan(14)

  const drive1 = tmpHyperdrive(t)
  const drive2 = tmpHyperdrive(t)

  await drive1.put('/allowed.txt', 'a1')
  await drive1.put('/denied.txt', '0')

  await drive2.put('/allowed.txt', 'b1')
  await drive2.put('/denied.txt', '0')

  const releases = {
    default: 0,
    [drive2.key.toString('hex')]: 0
  }

  const serve = tmpServe(t, {
    get ({ key, filename, version }) {
      if (filename === '/denied.txt') return null
      else if (filename !== '/allowed.txt') t.fail('Wrong filename: ' + filename)

      if (key === null) return drive1
      else if (key.equals(drive2.key)) return drive2
      else t.fail('Wrong drive key')
    },
    release ({ key, drive }) {
      if (!key) t.ok(drive === drive1)
      else t.ok(drive === drive2)
      releases[key ? key.toString('hex') : 'default']++
    }
  })
  await serve.ready()

  const a = await request(serve, 'allowed.txt')
  t.is(a.status, 200)
  t.is(a.data, 'a1')
  t.alike(releases, {
    default: 1,
    [drive2.key.toString('hex')]: 0
  })

  const b = await request(serve, 'denied.txt')
  t.is(b.status, 404)
  t.is(b.data, '')
  t.alike(releases, {
    default: 1,
    [drive2.key.toString('hex')]: 0
  })

  const c = await request(serve, 'allowed.txt', { key: drive2.id })
  t.is(c.status, 200)
  t.is(c.data, 'b1')
  t.alike(releases, {
    default: 1,
    [drive2.key.toString('hex')]: 1
  })

  const d = await request(serve, 'denied.txt', { key: drive2.id })
  t.is(d.status, 404)
  t.is(d.data, '')
  t.alike(releases, {
    default: 1,
    [drive2.key.toString('hex')]: 1
  })
})

test('version in get hook', async function (t) {
  t.plan(12)

  const drive = tmpHyperdrive(t)

  await drive.put('/a.txt', 'a')
  await drive.put('/b.txt', 'b')

  let expected = 0

  const serve = tmpServe(t, {
    get ({ key, filename, version }) {
      if (++expected === 1) t.is(version, 0)
      if (++expected === 2) t.is(version, 0)
      else if (++expected === 3) t.is(version, 3)
      else if (++expected === 4) t.is(version, 2)
      return drive
    }
  })
  await serve.ready()

  const a = await request(serve, 'a.txt')
  t.is(a.status, 200)
  t.is(a.data, 'a')

  const b = await request(serve, 'a.txt', { version: 0 })
  t.is(b.status, 200)
  t.is(b.data, 'a')

  const c = await request(serve, 'b.txt', { version: 3 })
  t.is(c.status, 200)
  t.is(c.data, 'b')

  const d = await request(serve, 'b.txt', { version: 2 })
  t.is(d.status, 404)
  t.is(d.data, '')

  const e = await request(serve, 'b.txt', { version: 'two' })
  t.is(e.status, 400)
  t.is(e.data, '')
})

test('file server does not wait for reqs to finish before closing', async function (t) {
  t.plan(3)

  const drive = tmpHyperdrive(t)

  const manyBytes = 'a'.repeat(256 * 1024 * 1024)
  await drive.put('/file.txt', manyBytes)

  let released = 0
  const serve = tmpServe(t, {
    get: () => drive,
    release: () => released++
  })
  await serve.ready()

  request(serve, '/file.txt').catch(function () {
    t.pass('request should fail')
  })

  const res = await new Promise(resolve => serve.server.once('request', (req, res) => resolve(res)))

  res.on('finish', function () {
    t.fail('request should not be ended')
  })

  res.on('close', function () {
    t.pass('request closed')
  })

  await serve.close()

  t.is(released, 1)
})

test('suspend', async function (t) {
  t.plan(2)

  const drive = tmpHyperdrive(t)
  await drive.put('/file.txt', 'hello')

  const serve = tmpServe(t, { get: () => drive })
  await serve.ready()

  await serve.suspend()
  await serve.resume()

  const a = await request(serve, 'file.txt')
  t.is(a.status, 200)
  t.is(a.data, 'hello')
})

test('internal port changes for suspend - custom port', async function (t) {
  t.plan(5)

  const serve = tmpServe(t, { port: 1234 })
  await serve.ready()
  t.is(serve.address().port, serve.port)

  const serve2 = tmpServe(t, { port: 1234 })
  await serve2.ready()
  t.is(serve2.address().port, serve2.port)

  await serve.close()

  const before = serve2.port
  await serve2.suspend()
  await serve2.resume()
  const after = serve2.port

  t.is(before, after)

  t.not(serve2.port, 1234)
  t.is(serve2.address().port, serve2.port)
})

test('internal port changes for suspend - zero port', async function (t) {
  t.plan(2)

  const serve = tmpServe(t, { port: 0 })
  await serve.ready()
  t.is(serve.address().port, serve.port)

  const before = serve.address().port
  await serve.suspend()
  await serve.resume()
  const after = serve.address().port

  t.is(before, after)
})
