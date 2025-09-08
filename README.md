# Russian Post API Client

This repository contains a ZIP archive `tracknew.zip` with a Node.js application for interacting with the Russian Post SOAP tracking service.

## Available Specifications
The client implements the following Russian Post operations:

- `getOperationHistory` – returns the history for a single barcode.
- `ticketRequest` – accepts a batch of barcodes and returns a processing ticket.
- `answerByTicketRequest` – checks processing results for a previously issued ticket.

The underlying service endpoints are configured in `config.js` and default to `https://tracking.russianpost.ru/rtm34` for single requests and `https://tracking.russianpost.ru/fc` for batch operations.

## Emulating Letter Uploads
To emulate uploading barcodes to the Russian Post service:

```javascript
const RussianPostApiClient = require('./russianPostApiClient');
const client = new RussianPostApiClient();

const login = process.env.RP_LOGIN;
const password = process.env.RP_PASSWORD;
const barcodes = ['RR123456789RU'];

async function run() {
  const ticket = await client.getTicket(login, password, barcodes);
  console.log('Ticket:', ticket);
  const status = await client.getBatchStatus(login, password, ticket);
  console.log('Status:', status);
}

run().catch(console.error);
```

## Configuration
Key settings are stored in `config.js` and may be overridden with environment variables:

- `PORT` – HTTP server port.
- `POCHTA_SINGLE_URL` / `POCHTA_BATCH_URL` – endpoints for single and batch SOAP requests.
- `API_TIMEOUT_MS` – request timeout in milliseconds.

## Local Emulator
For offline testing without real Russian Post credentials, a simple SOAP emulator is provided.

```bash
cd tracknew
npm install
npm run emulator
```

Then point the API client to the emulator endpoints:

```bash
export POCHTA_SINGLE_URL=http://localhost:8080/rtm34
export POCHTA_BATCH_URL=http://localhost:8080/fc
```

The emulator returns canned responses and skips authentication.

## Testing
The project does not ship with automated tests. Running `npm test` prints an error message. To manage tests, add test files and update the `test` script in `package.json` (for example, using `mocha` or Node's built-in `assert`).

```bash
npm test
```

## Notes
The example code assumes the archive is unpacked so that `russianPostApiClient.js` is available in the working directory. Credentials for the Russian Post API must be supplied via environment variables or directly in the script.
