const Hyperdrive = require('hyperdrive')
const test = require('brittle')
const axios = require('axios')
const ram = require('random-access-memory')
const Corestore = require('corestore')
const Localdrive = require('localdrive')
const path = require('node:path')
const os = require('node:os')
const fs = require('fs/promises')

const serveDrive = require('..')

async function getTempDir (t) {
  const dir = path.join(os.tmpdir(), Math.random().toString().slice(2))

  t.teardown(async () => {
    await fs.rm(dir, { force: true, recursive: true })
  })
  return path.normalize(dir)
}

async function setup (t, { isHyper = true } = {}) {
  const store = isHyper ? new Corestore(ram) : null
  const drive = isHyper ? new Hyperdrive(store) : new Localdrive(await getTempDir(t))

  const server = await serveDrive(drive)

  t.teardown(() => {
    server.close()
    store?.close()
  })

  return { server, drive }
}

test('Can get existing file from drive', async t => {
  t.plan(2 * 2)

  for (const isHyper of [true, false]) {
    const { drive, server } = await setup(t, { isHyper })
    await drive.put('Something', 'Here')

    const resp = await axios.get(`http://localhost:${server.address().port}/Something`)

    t.is(resp.status, 200)
    t.is(resp.data, 'Here')
  }
})

test('404 if file not found', async t => {
  t.plan(2 * 2)

  for (const isHyper of [true, false]) {
    const { server } = await setup(t, { isHyper })
    const resp = await axios.get(
      `http://localhost:${server.address().port}/Nothing`, { validateStatus: null }
    )
    t.is(resp.status, 404)
    t.is(resp.data, 'File not found')
  }
})

test('checkout query param (hyperdrive)', async t => {
  const { drive, server } = await setup(t, { isHyper: true })
  await drive.put('Something', 'Here')
  const origV = drive.version
  t.is(origV, 2) // Sanity check

  await drive.put('irrelevant', 'stuff')
  await drive.put('Something', 'Else')

  const nowResp = await axios.get(`http://localhost:${server.address().port}/Something`)
  t.is(nowResp.status, 200)
  t.is(nowResp.data, 'Else')

  const oldResp = await axios.get(`http://localhost:${server.address().port}/Something?checkout=${origV}`)
  t.is(oldResp.status, 200)
  t.is(oldResp.data, 'Here')

  const futureResp = await axios.get(
    `http://localhost:${server.address().port}/Something?checkout=100`, { validateStatus: null }
  )
  t.is(futureResp.status, 404)
  t.is(futureResp.data, 'SNAPSHOT_NOT_AVAILABLE')
})

test('checkout query param ignored for local drive', async t => {
  const { drive, server } = await setup(t, { isHyper: false })
  await drive.put('Something', 'Here')
  await drive.put('irrelevant', 'stuff')
  await drive.put('Something', 'Else')

  const nowResp = await axios.get(`http://localhost:${server.address().port}/Something`)
  t.is(nowResp.status, 200)
  t.is(nowResp.data, 'Else')

  const oldResp = await axios.get(`http://localhost:${server.address().port}/Something?checkout=2`)
  t.is(oldResp.status, 200)
  t.is(oldResp.data, 'Else')

  const futureResp = await axios.get(`http://localhost:${server.address().port}/Something?checkout=100`)
  t.is(futureResp.status, 200)
  t.is(futureResp.data, 'Else')
})
