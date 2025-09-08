const express = require('express');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.EMULATOR_PORT || 8080;

app.use(bodyParser.text({ type: '*/*' }));

// Emulate single tracking request
app.post('/rtm34', (req, res) => {
  const match = req.body.match(/<data:Barcode>(.*?)<\/data:Barcode>/);
  const barcode = match ? match[1] : '00000000000000';
  const response = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
  <soap:Body>
    <getOperationHistoryResponse>
      <OperationHistoryData>
        <historyRecord>
          <OperationParameters>
            <OperType><Id>1</Id></OperType>
            <OperAttr><Id>1</Id></OperAttr>
          </OperationParameters>
          <ItemParameters>
            <Barcode>${barcode}</Barcode>
          </ItemParameters>
        </historyRecord>
      </OperationHistoryData>
    </getOperationHistoryResponse>
  </soap:Body>
</soap:Envelope>`;
  res.type('application/soap+xml').send(response);
});

// Emulate batch ticket and status requests
app.post('/fc', (req, res) => {
  if (req.body.includes('<ticketRequest>')) {
    const response = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <ticketResponse><value>TEST-TICKET</value></ticketResponse>
  </soapenv:Body>
</soapenv:Envelope>`;
    res.type('text/xml').send(response);
  } else if (req.body.includes('<answerByTicketRequest>')) {
    const response = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Body>
    <answerByTicketResponse>
      <value>
        <Item Barcode="12345678901234">
          <Operation OperTypeID="1" OperCtgID="1"/>
        </Item>
        <Item Barcode="999999999">
          <Error ErrorName="Barcode not found"/>
        </Item>
      </value>
    </answerByTicketResponse>
  </soapenv:Body>
</soapenv:Envelope>`;
    res.type('text/xml').send(response);
  } else {
    res.status(400).send('Unknown request');
  }
});

app.listen(PORT, () => {
  console.log(`Emulator running on port ${PORT}`);
});

