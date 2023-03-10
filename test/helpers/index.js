const fs = require('fs')
const os = require('os')
const path = require('path')
const RAM = require('random-access-memory')
const Corestore = require('corestore')
const Hyperdrive = require('hyperdrive')
const Localdrive = require('localdrive')
const axios = require('axios')
const serveDrive = require('../../index.js')

module.exports = {
  setup,
  request,
  tmpHyperdrive,
  tmpLocaldrive,
  createTmpDir
}

async function setup (t, { isHyper = true } = {}) {
  const store = isHyper ? new Corestore(RAM) : null
  const drive = isHyper ? new Hyperdrive(store) : new Localdrive(createTmpDir(t))

  const server = await serveDrive(drive)

  t.teardown(() => {
    server.close()
    store?.close()
  })

  return { server, drive }
}

async function request (server, uri) {
  return axios.get('http://localhost:' + server.address().port + uri)
}

function tmpHyperdrive (t) {
  const drive = new Hyperdrive(new Corestore(RAM))
  t.teardown(() => drive.close())
  return drive
}

function tmpLocaldrive (t) {
  const drive = new Localdrive(createTmpDir(t))
  t.teardown(() => drive.close())
  return drive
}

function createTmpDir (t) {
  const tmpdir = path.join(os.tmpdir(), 'serve-drive-test-')
  const dir = fs.mkdtempSync(tmpdir)
  t.teardown(() => rmdir(dir))
  return dir
}

async function rmdir (dir) {
  try {
    await fs.promises.rm(dir, { force: true, recursive: true })
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
}
