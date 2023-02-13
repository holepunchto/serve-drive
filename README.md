# serve-drive

HTTP drive server for entries delivery. Auto detects types like video, images, etc

```
npm i serve-drive
```

## Usage
```javascript
const serve = require('serve-drive')
const Localdrive = require('localdrive')

const drive = new Localdrive('./my-folder')
await drive.put('/index.html', Buffer.from('hi'))

const server = await serve(drive)
console.log('Listening on http://localhost:' + server.address().port)

// Try visit http://localhost:7000/index.html
```

## API

#### `const server = await serve(drive, [options])`

Creates a HTTP server that serves entries from a `Hyperdrive` or `Localdrive`.

Available `options`:
```js
{
  port: 7000,
  host: '0.0.0.0',
  anyPort: true,
  server: null
}
```

You could pass your own server instance, for example:
```js
const http = require('http')
const graceful = require('graceful-http')
const goodbye = require('graceful-goodbye')

const server = http.createServer()
const close = graceful(server)
await serve(drive, { server })

goodbye(() => close())
```

## License
MIT
