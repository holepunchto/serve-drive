const fs = require('fs')
const os = require('os')
const path = require('path')
const RAM = require('random-access-memory')
const Corestore = require('corestore')
const Hyperdrive = require('hyperdrive')
const Localdrive = require('localdrive')
const axios = require('axios')
const ServeDrive = require('../../index.js')

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

  const serve = new ServeDrive(drive)
  await serve.ready()

  t.teardown(async () => {
    await serve.close()
    store?.close()
  })

  return { serve, drive }
}

async function request (serve, uri) {
  return axios.get('http://localhost:' + serve.address().port + uri, { validateStatus: false })
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
