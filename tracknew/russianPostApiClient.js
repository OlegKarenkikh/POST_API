// tracknew/russianPostApiClient.js
const fetch = require('node-fetch'); // node-fetch@2
const AbortController = require('abort-controller');
const { parseStringPromise } = require('xml2js');
const config = require('./config');
const { log } = require('./logger');
const { ApiError, ParsingError, BatchNotReadyError } = require('./utils');
// Импортируем парсеры
const { parseSingleResponse, parseTicketResponse, parseBatchResponseForStatus } = require('./parsers');

// Таймаут запроса в миллисекундах
const REQUEST_TIMEOUT_MS = config.requestTimeoutMs;

// Функция маскирования (для логов внутри этого модуля)
function maskCredentialsForLog(data) {
    if (typeof data !== 'string') return data;
    return data.replace(/<data:login>.*?<\/data:login>/gs, '<data:login>***</data:login>')
               .replace(/<login>.*?<\/login>/gs, '<login>***</login>')
               .replace(/<data:password>.*?<\/data:password>/gs, '<data:password>***</data:password>')
               .replace(/<password>.*?<\/password>/gs, '<password>***</password>');
}

class RussianPostApiClient {
    constructor() {}

    // --- Base Method for SOAP Requests with Timeout ---
    async #makeSoapRequest(serviceKey, xmlBody) {
        const serviceConfig = config.services[serviceKey];
        if (!serviceConfig) { throw new Error(`Invalid service key: ${serviceKey}`); }
        const { url, contentType, soapAction } = serviceConfig;
        const requestStartTime = Date.now();
        log('debug', `ApiClient: Sending SOAP request to ${serviceKey} (${url})`, maskCredentialsForLog(xmlBody));

        const controller = new AbortController();
        const timeoutId = setTimeout(() => { log('warn', `ApiClient: Request to ${serviceKey} timed out after ${REQUEST_TIMEOUT_MS}ms.`); controller.abort(); }, REQUEST_TIMEOUT_MS);
        let response;
        try {
            const headers = { 'Content-Type': contentType };
            if (soapAction !== undefined) { headers['SOAPAction'] = soapAction; } // Add SOAPAction only if defined (for SOAP 1.1)

            response = await fetch(url, { method: 'POST', headers: headers, body: xmlBody, signal: controller.signal });
            clearTimeout(timeoutId); // Clear timeout if fetch completes
            const responseText = await response.text(); // Read response body as text
            const duration = Date.now() - requestStartTime;
            log('debug', `ApiClient: Response (Status: ${response.status}, Duration: ${duration}ms) from ${serviceKey}`, responseText.substring(0, 1000) + (responseText.length > 1000 ? '...' : ''));

            if (!response.ok) {
                log('error', `ApiClient: API Error Response Body (Status ${response.status}) from ${serviceKey}:`, responseText.substring(0, 1000));
                let faultMessage = `API request failed with status ${response.status}.`;
                try {
                    // Try parsing fault even on non-2xx response
                    const errorResult = await parseStringPromise(responseText, { explicitArray: false, ignoreAttrs: true, tagNameProcessors: [tag => tag.replace(/^[a-zA-Z0-9]+:/, '')] });
                    const fault = errorResult?.Envelope?.Body?.Fault;
                    if (fault) {
                         const reasonText = fault.Reason?.Text ?? fault.faultstring ?? 'Unknown Fault';
                         const faultCode = fault.Code?.Value ?? fault.faultcode ?? 'Code N/A';
                         faultMessage = `API Error (${faultCode}): ${reasonText}`;
                         log('error', `ApiClient: Parsed SOAP Fault: Code=${faultCode}, Reason=${reasonText}`);
                    } else { faultMessage += ' Could not parse fault structure.'; }
                } catch (parseErr) { faultMessage += ' Response body might not be valid XML.'; }
                throw new ApiError(faultMessage, response.status); // Throw specific ApiError
            }
            // Return raw XML text for specific parsers
            return responseText;
        } catch (error) {
            clearTimeout(timeoutId); // Ensure timeout is cleared on any error
            const duration = Date.now() - requestStartTime;
            let finalErrorMessage = error.message;
            let errorToThrow = error; // Default to original error

            if (error.name === 'AbortError') {
                finalErrorMessage = `API request timed out after ${REQUEST_TIMEOUT_MS}ms.`;
                errorToThrow = new ApiError(finalErrorMessage, 504); // Gateway Timeout
            } else if (error instanceof ApiError) {
                // Already an ApiError, just log and rethrow
            } else {
                // Network errors or other fetch issues
                finalErrorMessage = `Network/Fetch error: ${error.message}`;
                errorToThrow = new ApiError(finalErrorMessage, response?.status || 503); // Service Unavailable or original status
            }
            log('error', `ApiClient: Error during SOAP request to ${serviceKey} (Duration: ${duration}ms): ${finalErrorMessage}`, error.stack);
            throw errorToThrow; // Rethrow the processed error
        }
    }

    // --- API Methods ---

    async getSingleHistory(login, password, barcode) {
        log('info', `ApiClient: Requesting single history for ${barcode}`);
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:oper="http://russianpost.org/operationhistory" xmlns:data="http://russianpost.org/operationhistory/data">
<soap:Header/>
<soap:Body>
<oper:getOperationHistory>
<data:OperationHistoryRequest><data:Barcode>${barcode}</data:Barcode><data:MessageType>0</data:MessageType><data:Language>RUS</data:Language></data:OperationHistoryRequest>
<data:AuthorizationHeader soap:mustUnderstand="1"><data:login>${login}</data:login><data:password>${password}</data:password></data:AuthorizationHeader>
</oper:getOperationHistory>
</soap:Body>
</soap:Envelope>`.trim();
        const responseText = await this.#makeSoapRequest('single', xml);
        // Pass raw XML to the specific parser
        return parseSingleResponse(responseText);
    }

    async getTicket(login, password, barcodes) {
        log('info', `ApiClient: Requesting ticket for ${barcodes.length} barcodes.`);
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:pos="http://fclient.russianpost.org/postserver" xmlns:fcl="http://fclient.russianpost.org">
<soapenv:Header/>
<soapenv:Body>
<pos:ticketRequest>
<request>${barcodes.map(code => `<fcl:Item Barcode="${code}"/>`).join('')}</request>
<login>${login}</login><password>${password}</password><language>RUS</language>
</pos:ticketRequest>
</soapenv:Body>
</soapenv:Envelope>`.trim();
        const responseText = await this.#makeSoapRequest('batch', xml);
        // Pass raw XML to the specific parser
        return parseTicketResponse(responseText);
    }

    async getBatchStatus(login, password, ticket) {
        log('info', `ApiClient: Requesting batch status for ticket ${ticket}`);
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:pos="http://fclient.russianpost.org/postserver">
<soapenv:Header/>
<soapenv:Body>
<pos:answerByTicketRequest>
<ticket>${ticket}</ticket><login>${login}</login><password>${password}</password>
</pos:answerByTicketRequest>
</soapenv:Body>
</soapenv:Envelope>`.trim();
        const responseText = await this.#makeSoapRequest('batch', xml);
        // Pass raw XML to the specific parser
        return parseBatchResponseForStatus(responseText);
    }
}

module.exports = RussianPostApiClient;