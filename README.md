# serve-drive

HTTP drive server for entries delivery. Auto detects types like video, images, etc

```
npm i serve-drive
```

## Usage

Single drive:
```js
const ServeDrive = require('serve-drive')
const Localdrive = require('localdrive')

const drive = new Localdrive('./my-folder')
await drive.put('/index.html', Buffer.from('hi'))

const serve = new ServeDrive({ get: ({ key, filename, version }) => drive })
await serve.ready()
console.log('Listening on http://localhost:' + serve.address().port)

// Try visiting http://localhost:7000/index.html
```

Multiple drives:
```js
const Localdrive = require('localdrive')
const Hyperdrive = require('hyperdrive')
const Corestore = require('corestore')

const drive1 = new Localdrive('./my-folder-a')
const drive2 = new Hyperdrive(new Corestore('./store1'))

await drive1.put('/index.html', Buffer.from('a'))
await drive2.put('/index.html', Buffer.from('b'))

const serve = new ServeDrive({
  get ({ key, filename, version }) {
    if (key === null) return drive1 // Default
    if (key.equals(drive2.key)) return drive2
    return null
  }
})

await serve.ready()
console.log('Listening on http://localhost:' + serve.address().port)

// Try visiting http://localhost:7000/index.html?key=<id-or-key>
```

## API

#### `const serve = new ServeDrive([options])`

Creates a HTTP server that serves entries from a `Hyperdrive` or `Localdrive`.

Available query params:
- `key` to select which drive to use i.e. `/filename?key=<id-or-key>`.
- `version` to checkout into a specific point i.e. `/filename?version=<v>`.

Available `options`:
```js
{
  async get ({ key, filename, version }) {}, // Return the drive or null
  async release ({ key, drive }) {}, // Called after finishing a request to optionally release the drive
  port: 7000,
  host: '0.0.0.0',
  anyPort: true,
  server: null
}
```

#### `serve.getLink(filename, [options])`

Generates the full API link to a file.

`options` includes:
```js
{
  https: false, // Set it to true to use https (default is false)
  host: '', // Custom host + port (default is 127.0.0.1:server-port)
  key: '', // Drive id or key
  version: 0 // Checkout the drive into a previous point
}
```

## License

Apache-2.0
