const test = require('brittle')
const ServeDrive = require('..')
const { request, tmpServe, tmpHyperdrive, tmpLocaldrive, localIP } = require('./helpers/index.js')
const axios = require('axios')
const RAM = require('random-access-memory')
const Hyperdrive = require('hyperdrive')
const Corestore = require('corestore')
const b4a = require('b4a')

test('Can get existing file from drive (default-drive pattern)', async t => {
  t.plan(2 * 3)

  for (const isHyper of [true, false]) {
    const drive = isHyper ? tmpHyperdrive(t) : tmpLocaldrive(t)

    let released = false
    const getDrive = () => drive
    const releaseDrive = () => { released = true }

    await drive.put('Something', 'Here')

    const serve = tmpServe(t, { getDrive, releaseDrive })
    await serve.ready()

    const res = await request(serve, 'Something')
    t.is(res.status, 200)
    t.is(res.data, 'Here')
    t.is(released, true)
  }
})

test('getDrive passes cleaned up path', async t => {
  const drive = tmpHyperdrive(t)

  let passedPath = null
  const getDrive = (key, path) => {
    passedPath = path
    return drive
  }
  await drive.put('Something spacy', 'Here')

  const serve = tmpServe(t, { getDrive })
  await serve.ready()

  const res = await request(serve, 'Something spacy')
  t.is(res.data, 'Here')
  t.is(passedPath, '/Something spacy')
})

test('getLink handles different path formats', async t => {
  const serve = tmpServe(t, { getDrive: noop })
  await serve.ready()
  const link1 = serve.getLink('myFile')
  const link2 = serve.getLink('/myFile')
  const link3 = serve.getLink('./myFile')

  const base = `http://127.0.0.1:${serve.address().port}`
  t.is(link1, link2)
  t.is(link1, link3)
  t.is(link1, `${base}/myFile`)

  const link4 = serve.getLink('/myDir/myFile.txt')
  t.is(link4, `${base}/myDir/myFile.txt`)
})

test('getLink optional params', async t => {
  const serve = tmpServe(t, { getDrive: noop })
  await serve.ready()

  const base = `http://127.0.0.1:${serve.address().port}`
  t.is(serve.getLink('file', { id: 'an-alias' }), `${base}/file?id=an-alias`)
  t.is(serve.getLink('file', { version: 5 }), `${base}/file?version=5`)
  t.is(serve.getLink('file', { id: 'an-alias', version: 5 }), `${base}/file?id=an-alias&version=5`)
  t.is(serve.getLink('file', { secure: true }), 'https://127.0.0.1:' + serve.address().port + '/file')
})

test('getLink reverse-proxy use case', async t => {
  const serve = tmpServe(t, { getDrive: noop })
  await serve.ready()

  t.is(serve.getLink('file', { secure: true, host: 'www.mydrive.org' }), 'https://www.mydrive.org/file')
  t.is(serve.getLink('file', { secure: true, host: 'www.mydrive.org', id: 'myId' }), 'https://www.mydrive.org/file?id=myId')
  t.is(serve.getLink('file', { secure: true, host: 'www.mydrive.org:40000', version: 5 }), 'https://www.mydrive.org:40000/file?version=5')
})

test('getLink with different server address', async t => {
  const host = localIP() // => '192.168.0.23'
  if (!host) return t.fail('No local address')

  const serve = tmpServe(t, { host, getDrive: noop })
  await serve.ready()

  t.is(serve.getLink('file'), 'http://' + host + ':' + serve.address().port + '/file')
})

test('emits request-error if unexpected error when getting entry', async t => {
  const drive = tmpHyperdrive(t)
  await drive.close() // Will cause errors

  const getDrive = () => drive
  const serve = tmpServe(t, { getDrive })

  let errorObj
  serve.on('request-error', e => { errorObj = e })
  await serve.ready()

  const res = await request(serve, 'Whatever')
  t.is(res.status, 500)
  t.is(errorObj.code, 'SESSION_CLOSED')
})

test('404 if file not found', async t => {
  t.plan(2 * 3)

  for (const isHyper of [true, false]) {
    const drive = isHyper ? tmpHyperdrive(t) : tmpLocaldrive(t)
    await drive.ready()

    let released = false
    const getDrive = () => drive
    const releaseDrive = () => { released = true }

    const serve = tmpServe(t, { getDrive, releaseDrive })
    await serve.ready()

    const res = await request(serve, '/Nothing')
    t.is(res.status, 404)
    t.is(res.data, '')
    t.is(released, true)
  }
})

test('checkout query param (hyperdrive)', async t => {
  const drive = tmpHyperdrive(t)
  await drive.put('Something', 'Here')

  let released = 0
  const getDrive = () => drive
  const releaseDrive = () => { released += 1 }

  const serve = tmpServe(t, { getDrive, releaseDrive })
  await serve.ready()

  const origV = drive.version
  t.is(origV, 2) // Sanity check

  await drive.put('irrelevant', 'stuff')
  await drive.put('Something', 'Else')

  const nowResp = await request(serve, 'Something')
  t.is(nowResp.status, 200)
  t.is(nowResp.data, 'Else')
  t.is(released, 1)

  const oldResp = await request(serve, 'Something', { version: origV })
  t.is(oldResp.status, 200)
  t.is(oldResp.data, 'Here')
  t.is(released, 2)

  // Hangs until future version found
  await t.exception(
    axios.get(
      `http://127.0.0.1:${serve.address().port}/Something?version=100`,
      { timeout: 200 }
    ),
    /timeout/
  )
  // TODO: investigate (await snapshot.entry(...) hang forever
  // despite the snapshot being closed
  // t.is(released, 3)
})

test('can handle a non-ready drive', async function (t) {
  const store = new Corestore(RAM.reusable())
  const drive = new Hyperdrive(store.namespace('drive'))
  await drive.put('file', 'here')
  const key = drive.key

  await drive.close()

  const reDrive = new Hyperdrive(store.namespace('drive'), key)

  let released = 0
  const getDrive = () => reDrive
  const releaseDrive = () => { released += 1 }

  const serve = tmpServe(t, { getDrive, releaseDrive })
  await serve.ready()

  t.is(reDrive.opened, false)
  // drive is not ready but key is sync => no error
  // serve.add(reDrive)

  const resp = await request(serve, 'file')
  t.is(resp.status, 200)
  t.is(resp.data, 'here')
  t.is(released, 1)
})

test('checkout query param ignored for local drive', async t => {
  const drive = tmpLocaldrive(t)
  await drive.put('Something', 'Here')
  await drive.put('irrelevant', 'stuff')
  await drive.put('Something', 'Else')

  let released = 0
  const getDrive = () => drive
  const releaseDrive = () => { released += 1 }

  const serve = tmpServe(t, { getDrive, releaseDrive })
  await serve.ready()

  const nowResp = await axios.get(`http://127.0.0.1:${serve.address().port}/Something`)
  t.is(nowResp.status, 200)
  t.is(nowResp.data, 'Else')
  t.is(released, 1)

  const oldResp = await axios.get(`http://127.0.0.1:${serve.address().port}/Something?version=2`)
  t.is(oldResp.status, 200)
  t.is(oldResp.data, 'Else')
  t.is(released, 2)

  const futureResp = await axios.get(`http://127.0.0.1:${serve.address().port}/Something?version=100`)
  t.is(futureResp.status, 200)
  t.is(futureResp.data, 'Else')
  t.is(released, 3)
})

test('multiple drives', async t => {
  t.plan(4 * 3)

  const defaultDrive = tmpHyperdrive(t)
  const localdrive = tmpLocaldrive(t)
  const hyperdrive = tmpHyperdrive(t)

  await defaultDrive.put('file.txt', 'a')
  await localdrive.put('file.txt', 'b')
  await hyperdrive.put('file.txt', 'c')
  const hyperdriveId = b4a.toString(hyperdrive.key, 'hex')

  const releases = {
    default: 0,
    'custom-alias': 0,
    [hyperdriveId]: 0
  }
  const getDrive = (id) => {
    if (!id) return defaultDrive
    if (id === 'custom-alias') return localdrive
    if (id === hyperdriveId) return hyperdrive

    return null
  }
  const releaseDrive = (id) => {
    if (id && ![...Object.keys(releases)].includes(id)) return
    releases[id != null ? id : 'default'] += 1
  }

  const serve = tmpServe(t, { getDrive, releaseDrive })
  await serve.ready()

  const a = await request(serve, 'file.txt')
  t.is(a.status, 200)
  t.is(a.data, 'a')
  t.alike(releases, {
    default: 1,
    'custom-alias': 0,
    [hyperdriveId]: 0
  })

  const b = await request(serve, 'file.txt', { id: 'custom-alias' })
  t.is(b.status, 200)
  t.is(b.data, 'b')
  t.alike(releases, {
    default: 1,
    'custom-alias': 1,
    [hyperdriveId]: 0
  })

  const c = await request(serve, 'file.txt', { id: hyperdriveId })
  t.is(c.status, 200)
  t.is(c.data, 'c')
  t.alike(releases, {
    default: 1,
    'custom-alias': 1,
    [hyperdriveId]: 1
  })

  const d = await request(serve, 'file.txt', { id: 'not-exists' })
  t.is(d.status, 404)
  t.is(d.data, '')
  t.alike(releases, {
    default: 1,
    'custom-alias': 1,
    [hyperdriveId]: 1
  })
})

test('filter', async function (t) {
  t.plan(4 * 4)

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
  const getDrive = (id) => {
    if (!id) return hyperdrive
    if (id === 'custom') return localdrive

    return null
  }
  const releaseDrive = (id) => {
    releases[id != null ? id : 'default'] += 1
  }

  const serve = new ServeDrive({
    getDrive,
    releaseDrive,
    filter: function (id, filename) {
      if (id === null) t.pass()
      else if (id === 'custom') t.pass()
      else t.fail('Wrong drive id')

      if (filename === '/allowed.txt') return true
      else if (filename === '/denied.txt') return false
      else t.fail('Wrong filename: ' + filename)
    }
  })

  t.teardown(() => serve.close())
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

  const c = await request(serve, 'allowed.txt', { id: 'custom' })
  t.is(c.status, 200)
  t.is(c.data, 'b1')
  t.alike(releases, {
    default: 2,
    custom: 1
  })

  const d = await request(serve, 'denied.txt', { id: 'custom' })
  t.is(d.status, 404)
  t.is(d.data, '')
  t.alike(releases, {
    default: 2,
    custom: 2
  })
})

test('file server does not wait for reqs to finish before closing', async t => {
  t.plan(3)

  const drive = tmpHyperdrive(t)

  let released = 0
  const getDrive = () => drive
  const releaseDrive = () => { released++ }

  const manyBytes = 'a'.repeat(1000 * 1000 * 250)
  await drive.put('Something', manyBytes)

  const serve = tmpServe(t, { getDrive, releaseDrive })
  await serve.ready()

  request(serve, 'Something').catch(function () {
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

function noop () {}
