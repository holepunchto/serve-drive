const test = require('brittle')
const ServeDrive = require('..')
const { request, tmpServe, tmpHyperdrive, tmpLocaldrive } = require('./helpers/index.js')
const axios = require('axios')

test('Can get existing file from drive', async t => {
  t.plan(2 * 2)

  for (const isHyper of [true, false]) {
    const drive = isHyper ? tmpHyperdrive(t) : tmpLocaldrive(t)
    await drive.put('Something', 'Here')

    const serve = tmpServe(t)
    serve.add(drive, { default: true })
    await serve.ready()

    const res = await request(serve, '/Something')
    t.is(res.status, 200)
    t.is(res.data, 'Here')
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
