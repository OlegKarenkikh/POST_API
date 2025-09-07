const { expect } = require('chai');
const { parseStringPromise } = require('xml2js');

describe('XML parser security', () => {
  it('rejects XML with external entity declarations', async () => {
    const maliciousXml = `<?xml version="1.0"?>
<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<foo>&xxe;</foo>`;
    try {
      await parseStringPromise(maliciousXml);
      throw new Error('Parser did not reject external entity');
    } catch (err) {
      expect(err.message).to.match(/entity|doctype/i);
    }
  });
});
