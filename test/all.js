const Hyperdrive = require('hyperdrive')
const test = require('brittle')
const axios = require('axios')
const ram = require('random-access-memory')
const Corestore = require('corestore')

const serveDrive = require('..')

async function setup (t) {
  const store = new Corestore(ram)
  const drive = new Hyperdrive(store)

  const server = await serveDrive(drive)

  t.teardown(() => {
    server.close()
    store.close()
  })

  return { server, drive }
}

test('Can get existing file from drive', async t => {
  const { drive, server } = await setup(t)
  await drive.put('Something', 'Here')

  const resp = await axios.get(`http://localhost:${server.address().port}/Something`)

  t.is(resp.status, 200)
  t.is(resp.data, 'Here')
})

test('404 if file not found', async t => {
  const { server } = await setup(t)

  await t.exception(
    async () => axios.get(`http://localhost:${server.address().port}/Nothing`),
    /.*status code 404/
  )
})

test('version query param', async t => {
  const { drive, server } = await setup(t)
  await drive.put('Something', 'Here')
  const origV = drive.version
  t.is(origV, 2) // Sanity check

  await drive.put('irrelevant', 'stuff')
  await drive.put('Something', 'Else')

  const nowResp = await axios.get(`http://localhost:${server.address().port}/Something`)
  t.is(nowResp.status, 200)
  t.is(nowResp.data, 'Else')

  const oldResp = await axios.get(`http://localhost:${server.address().port}/Something?v=${origV}`)
  t.is(oldResp.status, 200)
  t.is(oldResp.data, 'Here')

  // Future version
  await t.exception(
    async () => axios.get(`http://localhost:${server.address().port}/Something?v=100`),
    /.*status code 404/
  )
})
