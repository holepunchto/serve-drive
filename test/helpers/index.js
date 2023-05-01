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
  request,
  tmpServe,
  tmpHyperdrive,
  tmpLocaldrive,
  createTmpDir
}

async function request (serve, path, { id, version } = {}) {
  const link = serve.getLink(path, id, version)
  return axios.get(link, { validateStatus: false })
}

function tmpServe (t, getDrive, releaseDrive) {
  const serve = new ServeDrive(getDrive, releaseDrive)
  t.teardown(() => serve.close())
  return serve
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
