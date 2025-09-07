const { expect } = require('chai');
const { parseSingleResponse, parseTicketResponse, parseBatchResponseForStatus } = require('../parsers');

describe('Russian Post SOAP parsers', () => {
  it('parses ticket response and extracts ticket ID', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n`+
`<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">\n`+
`  <soapenv:Body>\n`+
`    <ticketResponse>\n`+
`      <value>ABC-123</value>\n`+
`    </ticketResponse>\n`+
`  </soapenv:Body>\n`+
`</soapenv:Envelope>`;
    const ticket = await parseTicketResponse(xml);
    expect(ticket).to.equal('ABC-123');
  });

  it('parses batch status with success and error items', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n`+
`<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">\n`+
`  <soapenv:Body>\n`+
`    <answerByTicketResponse>\n`+
`      <value>\n`+
`        <Item Barcode="12345678901234">\n`+
`          <Operation OperTypeID="2" OperCtgID="1"/>\n`+
`        </Item>\n`+
`        <Item Barcode="999999999">\n`+
`          <Error ErrorName="Barcode not found"/>\n`+
`        </Item>\n`+
`      </value>\n`+
`    </answerByTicketResponse>\n`+
`  </soapenv:Body>\n`+
`</soapenv:Envelope>`;
    const result = await parseBatchResponseForStatus(xml);
    expect(result.successItems).to.have.lengthOf(1);
    expect(result.successItems[0].Barcode).to.equal('12345678901234');
    expect(result.errorMessages['999999999']).to.equal('Barcode not found');
  });

  it('parses single history response and enriches operation data', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n`+
`<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">\n`+
`  <soap:Body>\n`+
`    <getOperationHistoryResponse>\n`+
`      <OperationHistoryData>\n`+
`        <historyRecord>\n`+
`          <OperationParameters>\n`+
`            <OperType><Id>2</Id></OperType>\n`+
`            <OperAttr><Id>1</Id></OperAttr>\n`+
`          </OperationParameters>\n`+
`          <ItemParameters>\n`+
`            <Barcode>12345678901234</Barcode>\n`+
`          </ItemParameters>\n`+
`        </historyRecord>\n`+
`      </OperationHistoryData>\n`+
`    </getOperationHistoryResponse>\n`+
`  </soap:Body>\n`+
`</soap:Envelope>`;
    const records = await parseSingleResponse(xml);
    expect(records).to.have.lengthOf(1);
    expect(records[0].ItemParameters.Barcode).to.equal('12345678901234');
    expect(records[0].OperationParameters.OperType.Name).to.be.a('string');
  });
});
