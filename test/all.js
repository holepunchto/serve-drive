const test = require('brittle')
const ServeDrive = require('..')
const { request, tmpServe, tmpHyperdrive, tmpLocaldrive } = require('./helpers/index.js')
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

    const serve = tmpServe(t, getDrive, releaseDrive)
    await serve.ready()

    const res = await request(serve, 'Something')
    t.is(res.status, 200)
    t.is(res.data, 'Here')
    t.is(released, true)
  }
})

test('404 if file not found', async t => {
  t.plan(2 * 3)

  for (const isHyper of [true, false]) {
    const drive = isHyper ? tmpHyperdrive(t) : tmpLocaldrive(t)
    await drive.ready()

    let released = false
    const getDrive = () => drive
    const releaseDrive = () => { released = true }

    const serve = tmpServe(t, getDrive, releaseDrive)
    await serve.ready()

    const res = await request(serve, '/Nothing')
    t.is(res.status, 404)
    t.is(res.data, 'ENOENT')
    t.is(released, true)
  }
})

test('checkout query param (hyperdrive)', async t => {
  const drive = tmpHyperdrive(t)
  await drive.put('Something', 'Here')

  let released = 0
  const getDrive = () => drive
  const releaseDrive = () => { released += 1 }

  const serve = tmpServe(t, getDrive, releaseDrive)
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
      `http://localhost:${serve.address().port}/Something?checkout=100`,
      { timeout: 200 }
    ),
    /timeout/
  )
  t.is(released, 3) // TODO: fix (release not called if cancelled)
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

  const serve = tmpServe(t, getDrive, releaseDrive)
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

  const serve = tmpServe(t, getDrive, releaseDrive)
  await serve.ready()

  const nowResp = await axios.get(`http://localhost:${serve.address().port}/Something`)
  t.is(nowResp.status, 200)
  t.is(nowResp.data, 'Else')
  t.is(released, 1)

  const oldResp = await axios.get(`http://localhost:${serve.address().port}/Something?checkout=2`)
  t.is(oldResp.status, 200)
  t.is(oldResp.data, 'Else')
  t.is(released, 2)

  const futureResp = await axios.get(`http://localhost:${serve.address().port}/Something?checkout=100`)
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

  const serve = tmpServe(t, getDrive, releaseDrive)
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
  t.is(d.data, 'DRIVE_NOT_FOUND')
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

  const serve = new ServeDrive(getDrive, releaseDrive, {
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
  t.is(b.data, 'ENOENT')
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
  t.is(d.data, 'ENOENT')
  t.alike(releases, {
    default: 2,
    custom: 2
  })
})
