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
  createTmpDir,
  localIP
}

async function request (serve, path, opts) {
  const link = serve.getLink(path, opts)
  return axios.get(link, { validateStatus: false })
}

function tmpServe (t, opts) {
  const serve = new ServeDrive(opts)
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

function localIP () {
  const ifaces = Object.values(os.networkInterfaces()).flat()
  const addrs = ifaces.filter(iface => !iface.internal && iface.family === 'IPv4')
  return addrs.length ? addrs[0].address : null
}
