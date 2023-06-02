const test = require('brittle')
const { request, tmpServe, tmpHyperdrive, tmpLocaldrive, localIP } = require('./helpers/index.js')
const axios = require('axios')
const RAM = require('random-access-memory')
const Hyperdrive = require('hyperdrive')
const Corestore = require('corestore')

test('Can get existing file from drive (default-drive pattern)', async function (t) {
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
  const serve = tmpServe(t)
  await serve.ready()

  const base = `http://127.0.0.1:${serve.address().port}`

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
  const serve = tmpServe(t)
  await serve.ready()

  const base = `http://127.0.0.1:${serve.address().port}`
  const baseSecure = `https://127.0.0.1:${serve.address().port}`

  t.is(serve.getLink('/file.txt', { key: 'an-alias' }), `${base}/file.txt?key=an-alias`)
  t.is(serve.getLink('/file.txt', { version: 5 }), `${base}/file.txt?version=5`)
  t.is(serve.getLink('/file.txt', { key: 'an-alias', version: 5 }), `${base}/file.txt?key=an-alias&version=5`)
  t.is(serve.getLink('/file.txt', { https: true }), `${baseSecure}/file.txt`)
})

test('getLink reverse-proxy use case', async function (t) {
  const serve = tmpServe(t)
  await serve.ready()

  t.is(serve.getLink('/file.txt', { host: 'www.mydrive.org' }), 'http://www.mydrive.org/file.txt')
  t.is(serve.getLink('/file.txt', { https: true, host: 'www.mydrive.org', key: 'myId' }), 'https://www.mydrive.org/file.txt?key=myId')
  t.is(serve.getLink('/file.txt', { https: true, host: 'www.mydrive.org:40000', version: 5 }), 'https://www.mydrive.org:40000/file.txt?version=5')
})

test('getLink with different server address', async function (t) {
  const host = localIP() // => '192.168.0.23'
  if (!host) return t.fail('No local address')

  const serve = tmpServe(t, { host })
  await serve.ready()

  t.is(serve.getLink('/file.txt'), 'http://' + host + ':' + serve.address().port + '/file.txt')
})

test('emits request-error if unexpected error when getting entry', async function (t) {
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

  const defaultDrive = tmpHyperdrive(t)
  const localdrive = tmpLocaldrive(t)
  const hyperdrive = tmpHyperdrive(t)

  await defaultDrive.put('file.txt', 'a')
  await localdrive.put('file.txt', 'b')
  await hyperdrive.put('file.txt', 'c')

  const releases = {
    default: 0,
    'custom-alias': 0,
    [hyperdrive.id]: 0
  }

  const serve = tmpServe(t, {
    get ({ key }) {
      if (!key) return defaultDrive
      if (key === 'custom-alias') return localdrive
      if (key === hyperdrive.id) return hyperdrive
      return null
    },
    release ({ key, drive }) {
      releases[key || 'default']++
    }
  })
  await serve.ready()

  const a = await request(serve, 'file.txt')
  t.is(a.status, 200)
  t.is(a.data, 'a')
  t.alike(releases, {
    default: 1,
    'custom-alias': 0,
    [hyperdrive.id]: 0
  })

  const b = await request(serve, 'file.txt', { key: 'custom-alias' })
  t.is(b.status, 200)
  t.is(b.data, 'b')
  t.alike(releases, {
    default: 1,
    'custom-alias': 1,
    [hyperdrive.id]: 0
  })

  const c = await request(serve, 'file.txt', { key: hyperdrive.id })
  t.is(c.status, 200)
  t.is(c.data, 'c')
  t.alike(releases, {
    default: 1,
    'custom-alias': 1,
    [hyperdrive.id]: 1
  })

  const d = await request(serve, 'file.txt', { key: 'not-exists' })
  t.is(d.status, 404)
  t.is(d.data, '')
  t.alike(releases, {
    default: 1,
    'custom-alias': 1,
    [hyperdrive.id]: 1
  })
})

test('filter', async function (t) {
  t.plan(4 * 5)

  const hyperdrive = tmpHyperdrive(t)
  const localdrive = tmpLocaldrive(t)

  await hyperdrive.put('/allowed.txt', 'a1')
  await hyperdrive.put('/denied.txt', '0')

  await localdrive.put('/allowed.txt', 'b1')
  await localdrive.put('/denied.txt', '0')

  const releases = {
    default: 0,
    custom: 0
  }

  const serve = tmpServe(t, {
    get ({ key }) {
      if (!key) return hyperdrive
      if (key === 'custom') return localdrive
      return null
    },
    release ({ key }) {
      releases[key || 'default']++
    },
    filter: function ({ key, filename, drive }) {
      t.is(typeof drive, 'object')

      if (key === null) t.pass()
      else if (key === 'custom') t.pass()
      else t.fail('Wrong drive key')

      if (filename === '/allowed.txt') return true
      else if (filename === '/denied.txt') return false
      else t.fail('Wrong filename: ' + filename)
    }
  })
  await serve.ready()

  const a = await request(serve, 'allowed.txt')
  t.is(a.status, 200)
  t.is(a.data, 'a1')
  t.alike(releases, {
    default: 1,
    custom: 0
  })

  const b = await request(serve, 'denied.txt')
  t.is(b.status, 404)
  t.is(b.data, '')
  t.alike(releases, {
    default: 2,
    custom: 0
  })

  const c = await request(serve, 'allowed.txt', { key: 'custom' })
  t.is(c.status, 200)
  t.is(c.data, 'b1')
  t.alike(releases, {
    default: 2,
    custom: 1
  })

  const d = await request(serve, 'denied.txt', { key: 'custom' })
  t.is(d.status, 404)
  t.is(d.data, '')
  t.alike(releases, {
    default: 2,
    custom: 2
  })
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
