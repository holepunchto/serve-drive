const test = require('brittle')
const ServeDrive = require('..')
const { request, tmpServe, tmpHyperdrive, tmpLocaldrive } = require('./helpers/index.js')
const axios = require('axios')
const RAM = require('random-access-memory')
const Hyperdrive = require('hyperdrive')
const Corestore = require('corestore')
const z32 = require('z32')

test.solo('Can get existing file from drive (default-drive pattern)', async t => {
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
  t.plan(2 * 2)

  for (const isHyper of [true, false]) {
    const drive = isHyper ? tmpHyperdrive(t) : tmpLocaldrive(t)
    await drive.ready()

    const serve = tmpServe(t)
    serve.add(drive, { default: true })
    await serve.ready()

    const res = await request(serve, '/Nothing')
    t.is(res.status, 404)
    t.is(res.data, 'ENOENT')
  }
})

test('checkout query param (hyperdrive)', async t => {
  const drive = tmpHyperdrive(t)
  await drive.put('Something', 'Here')

  const serve = tmpServe(t)
  serve.add(drive, { default: true })
  await serve.ready()

  const origV = drive.version
  t.is(origV, 2) // Sanity check

  await drive.put('irrelevant', 'stuff')
  await drive.put('Something', 'Else')

  const nowResp = await axios.get(`http://localhost:${serve.address().port}/Something`)
  t.is(nowResp.status, 200)
  t.is(nowResp.data, 'Else')

  const oldResp = await axios.get(`http://localhost:${serve.address().port}/Something?checkout=${origV}`)
  t.is(oldResp.status, 200)
  t.is(oldResp.data, 'Here')

  // Hangs until future version found
  await t.exception(
    axios.get(
      `http://localhost:${serve.address().port}/Something?checkout=100`,
      { timeout: 200 }
    ),
    /timeout/
  )
})

test('can add a non-ready drive with key', async function (t) {
  const store = new Corestore(RAM.reusable())
  const drive = new Hyperdrive(store.namespace('drive'))
  await drive.put('/file', 'here')
  const key = drive.key
  const zKey = z32.encode(key)

  await drive.close()

  const serve = tmpServe(t)
  await serve.ready()
  const reDrive = new Hyperdrive(store.namespace('drive'), key)

  t.is(reDrive.opened, false)
  // drive is not ready but key is sync => no error
  serve.add(reDrive)

  const resp = await request(serve, `/file?drive=${zKey}`)
  t.is(resp.status, 200)
  t.is(resp.data, 'here')
})

test('checkout query param ignored for local drive', async t => {
  const drive = tmpLocaldrive(t)
  await drive.put('Something', 'Here')
  await drive.put('irrelevant', 'stuff')
  await drive.put('Something', 'Else')

  const serve = tmpServe(t)
  serve.add(drive, { default: true })
  await serve.ready()

  const nowResp = await axios.get(`http://localhost:${serve.address().port}/Something`)
  t.is(nowResp.status, 200)
  t.is(nowResp.data, 'Else')

  const oldResp = await axios.get(`http://localhost:${serve.address().port}/Something?checkout=2`)
  t.is(oldResp.status, 200)
  t.is(oldResp.data, 'Else')

  const futureResp = await axios.get(`http://localhost:${serve.address().port}/Something?checkout=100`)
  t.is(futureResp.status, 200)
  t.is(futureResp.data, 'Else')
})

test('multiple drives', async t => {
  t.plan(8)

  const defaultDrive = tmpHyperdrive(t)
  const localdrive = tmpLocaldrive(t)
  const hyperdrive = tmpHyperdrive(t)

  await defaultDrive.put('/file.txt', 'a')
  await localdrive.put('/file.txt', 'b')
  await hyperdrive.put('/file.txt', 'c')

  const serve = new ServeDrive()

  serve.add(defaultDrive, { default: true })
  serve.add(localdrive, { alias: 'custom-alias' })
  serve.add(hyperdrive, { alias: hyperdrive.key.toString('hex') })

  t.teardown(() => serve.close())
  await serve.ready()

  const a = await request(serve, '/file.txt')
  t.is(a.status, 200)
  t.is(a.data, 'a')

  const b = await request(serve, '/file.txt?drive=custom-alias')
  t.is(b.status, 200)
  t.is(b.data, 'b')

  const c = await request(serve, '/file.txt?drive=' + hyperdrive.key.toString('hex'))
  t.is(c.status, 200)
  t.is(c.data, 'c')

  const d = await request(serve, '/file.txt?drive=not-exists')
  t.is(d.status, 404)
  t.is(d.data, 'DRIVE_NOT_FOUND')
})

test('filter', async function (t) {
  t.plan(12)

  const hyperdrive = tmpHyperdrive(t)
  const localdrive = tmpLocaldrive(t)

  await hyperdrive.put('/allowed.txt', 'a1')
  await hyperdrive.put('/denied.txt', '0')

  await localdrive.put('/allowed.txt', 'b1')
  await localdrive.put('/denied.txt', '0')

  const serve = new ServeDrive({
    filter: function (id, filename) {
      if (id === null) t.pass()
      else if (id === 'custom') t.pass()
      else t.fail('Wrong drive id')

      if (filename === '/allowed.txt') return true
      else if (filename === '/denied.txt') return false
      else t.fail('Wrong filename: ' + filename)
    }
  })

  serve.add(hyperdrive, { default: true })
  serve.add(localdrive, { alias: 'custom' })

  t.teardown(() => serve.close())
  await serve.ready()

  const a = await request(serve, '/allowed.txt')
  t.is(a.status, 200)
  t.is(a.data, 'a1')

  const b = await request(serve, '/denied.txt')
  t.is(b.status, 404)
  t.is(b.data, 'ENOENT')

  const c = await request(serve, '/allowed.txt?drive=custom')
  t.is(c.status, 200)
  t.is(c.data, 'b1')

  const d = await request(serve, '/denied.txt?drive=custom')
  t.is(d.status, 404)
  t.is(d.data, 'ENOENT')
})
