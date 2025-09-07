// tracknew/parsers.js
const { parseStringPromise } = require('xml2js');
const { log } = require('./logger');
const config = require('./config');
const { ParsingError, ApiError, BatchNotReadyError } = require('./utils');
// Импортируем функции обогащения из централизованного модуля
const { enrichHistoryRecord, enrichBatchOperation } = require('./dictionaries');

// --- Base Parser Options ---
const baseXmlParserOptions = {
    tagNameProcessors: [tag => tag.replace(/^[a-zA-Z0-9]+:/, '')], // Remove ns: prefixes
};

// --- Single Response Parser ---
async function parseSingleResponse(xml) {
    log('debug', '--- Starting Single Response Parsing ---');
    if (!xml || typeof xml !== 'string' || xml.trim() === '') { throw new ParsingError('Invalid or empty input to single parser.'); }
    log('debug', 'Raw XML input (single):', xml.substring(0, 500));

    let enrichedResult = [];
    try {
        // Используем mergeAttrs для удобного доступа к атрибутам
        const parserOptions = { ...baseXmlParserOptions, explicitArray: false, ignoreAttrs: false, mergeAttrs: true };
        const result = await parseStringPromise(xml, parserOptions);
        log('debug', 'Parsed JS object (Single - mergeAttrs=true):', result);

        const body = result?.Envelope?.Body;
        if (!body) { throw new ParsingError('Invalid SOAP structure: Missing Envelope/Body.'); }
        log('debug', 'Successfully accessed parsed body object (Single).');

        // Проверяем наличие SOAP Fault
        if (body?.Fault) {
            const faultString = body.Fault.Reason?.Text ?? body.Fault.faultstring ?? 'Unknown Fault';
            throw new ApiError(`API Error: ${faultString}`);
        }

        // Извлекаем данные истории
        const historyData = body?.getOperationHistoryResponse?.OperationHistoryData;
        if (historyData && historyData.historyRecord) {
            const records = Array.isArray(historyData.historyRecord) ? historyData.historyRecord : [historyData.historyRecord];
            log('info', `Parsed ${records.length} raw history records. Enriching...`);
            // Обогащаем каждую запись
            enrichedResult = records.map(enrichHistoryRecord);
        } else {
             log('info', 'No historyRecord data found in single response.');
             enrichedResult = [];
        }
    } catch (error) {
         log('error', `Error during single response parsing/enrichment: ${error.message}`, error.stack);
         enrichedResult = []; // Гарантируем массив при ошибке
         if (error instanceof ApiError || error instanceof ParsingError) { throw error; }
         throw new ParsingError(`Failed to process single track API response: ${error.message}`, error);
    }
    log('debug', `Final enriched data (Single): ${enrichedResult.length} items`);
    log('debug', '--- Finished Single Response Parsing ---');
    return enrichedResult; // Возвращаем обогащенный массив
}

// --- Ticket Response Parser ---
async function parseTicketResponse(xml) {
    log('debug', '--- Starting Ticket Response Parsing ---');
    if (!xml || typeof xml !== 'string' || xml.trim() === '') { throw new ParsingError('Invalid or empty input to ticket parser.'); }
    log('debug', 'Raw XML input (ticket):', xml.substring(0, 500));
    let ticket = null;
    try {
        // ignoreAttrs: true - атрибуты не нужны для тикета
        const parserOptions = { ...baseXmlParserOptions, explicitArray: false, ignoreAttrs: true };
        const result = await parseStringPromise(xml, parserOptions);
        log('debug', 'Parsed JS object (Ticket):', result);
        const body = result?.Envelope?.Body;
         if (!body) { throw new ParsingError('Invalid SOAP structure: Missing Envelope/Body.'); }
         log('debug', 'Successfully accessed parsed body object (Ticket).');
        if (body?.Fault) { throw new ApiError(`API Error: ${body.Fault.Reason?.Text ?? body.Fault.faultstring ?? 'Unknown Fault'}`); }
        // Доступ к значению тикета
        const ticketResponse = body?.ticketResponse ?? body?.getTicketResponse;
        const extractedValue = ticketResponse?.value;
        if (extractedValue && typeof extractedValue === 'string') {
            ticket = extractedValue; log('info', `Successfully parsed ticket: ${ticket}`);
        } else { throw new ParsingError('Failed to extract ticket ID string.'); }
    } catch (error) {
         log('error', `Error during ticket response parsing: ${error.message}`, error.stack);
         if (error instanceof ApiError || error instanceof ParsingError) { throw error; }
         throw new ParsingError('Failed to parse ticket API response.', error);
    }
    log('debug', 'Final extracted data (Ticket):', ticket);
    log('debug', '--- Finished Ticket Response Parsing ---');
    return ticket;
}

// --- Batch Status Parser ---
async function parseBatchResponseForStatus(xml) {
    log('debug', '--- Starting Batch Status Parsing ---');
    if (!xml || typeof xml !== 'string' || xml.trim() === '') { throw new ParsingError('Invalid or empty input to batch status parser.'); }
    log('debug', 'Raw XML input (batch status):', xml.substring(0, 1000));

    const resultData = { successItems: [], errorMessages: {} };
    let parsedResult = null;
    try {
        // Используем mergeAttrs для удобного доступа к атрибутам Item и Operation
        const parserOptions = { ...baseXmlParserOptions, explicitArray: false, ignoreAttrs: false, mergeAttrs: true };
        try {
             parsedResult = await parseStringPromise(xml, parserOptions);
             log('debug', `Parsed JS object keys (Batch Status): ${Object.keys(parsedResult || {})}`);
             log('debug', 'Parsed JS object FULL (Batch Status - mergeAttrs=true):', parsedResult);
        } catch (parseError) { throw new ParsingError(`Failed to parse batch status XML: ${parseError.message}`, parseError); }

        const envelope = parsedResult?.Envelope;
        if (!envelope) { throw new ParsingError("Invalid SOAP structure: Missing 'Envelope' object."); }
        const bodyContent = envelope?.Body;
        if (!bodyContent) { throw new ParsingError('Invalid SOAP structure: Missing body object after parsing.'); }
        log('debug', 'Successfully accessed parsed body object (Batch Status).');

        // 1. Check for Fault
        const fault = bodyContent?.Fault;
        if (fault) {
            const faultString = fault.faultstring ?? fault.Reason?.Text ?? 'Unknown SOAP Fault';
            const faultCode = fault.faultcode ?? fault.Code?.Value ?? 'Code N/A';
            // Проверяем на "Не готово" по тексту ошибки
            const lowerFault = faultString.toLowerCase();
             if (config.batchNotReadyMessages.some(msg => lowerFault.includes(msg.toLowerCase()))) {
                 throw new BatchNotReadyError();
             }
            throw new ApiError(`API Error (${faultCode}): ${faultString}`);
         }

        // 2. Check for <error> element (альтернативный способ сообщения об ошибке/статусе)
        const batchResponseElement = bodyContent?.answerByTicketResponse;
        if (!batchResponseElement) { throw new ParsingError('Missing answerByTicketResponse element.'); }
        const errorElement = batchResponseElement?.error; // Direct access due to mergeAttrs
        if (errorElement) {
             log('warn', 'Found <error> element structure:', errorElement);
             const errorTypeId = errorElement.ErrorTypeID;
             const errorName = errorElement.ErrorName;
             if (errorTypeId === config.batchNotReadyErrorId || config.batchNotReadyMessages.some(msg => errorName?.toLowerCase().includes(msg.toLowerCase()))) {
                 throw new BatchNotReadyError();
             } else {
                 const finalErrorId = errorTypeId || 'Unknown ID';
                 const finalErrorName = errorName || (errorElement._ || '?');
                 log('error', `API Reported Error in batch response header: ID=${finalErrorId}, Name=${finalErrorName}`);
                 // Можно добавить глобальную ошибку, если нужно
                 // resultData.globalError = `API Reported Error (${finalErrorId}): ${finalErrorName}`;
             }
        }

        // 3. Extract success/error items
        const value = batchResponseElement?.value;
        // Проверяем наличие value и value.Item
        if (value && value.Item) {
            const items = Array.isArray(value.Item) ? value.Item : [value.Item];
            log('info', `Parsing ${items.length} <Item> elements for status.`);
            items.forEach((item, index) => {
                // Атрибут Barcode доступен напрямую благодаря mergeAttrs
                const barcode = item.Barcode ?? null;
                log('debug', `Item ${index}: Extracted barcode: ${barcode}`);
                if (!barcode) { log('warn', `Item at index ${index} missing Barcode attribute.`); return; }

                const itemErrorElement = item.Error; // Доступ напрямую
                if (itemErrorElement) {
                    // Атрибут ErrorName доступен напрямую
                    resultData.errorMessages[barcode] = itemErrorElement.ErrorName ?? (itemErrorElement._ || '?');
                    log('warn', `Barcode ${barcode} has item-level error: ${resultData.errorMessages[barcode]}`);
                } else {
                    log('debug', `Barcode ${barcode} has NO item-level error. Enriching operations...`);
                    // Обогащаем операции внутри успешного Item
                    if (item.Operation) {
                        item.Operation = Array.isArray(item.Operation) ? item.Operation : [item.Operation];
                        item.Operation = item.Operation.map(enrichBatchOperation); // Enrich
                    } else {
                        item.Operation = []; // Гарантируем массив
                    }
                    resultData.successItems.push(item); // Добавляем обогащенный item
                }
            });
        } else if (!errorElement) { // Логируем отсутствие Item только если не было ошибки "Not Ready"
             log('info', 'Batch status response has no <Item> data (or <value> is missing/empty).');
             // В этом случае resultData останется { successItems: [], errorMessages: {} }
        }

    } catch (error) {
        log('error', `Error during batch status parsing function: ${error.message}`, error.stack);
        if (error instanceof BatchNotReadyError || error instanceof ApiError || error instanceof ParsingError) { throw error; }
        throw new ParsingError('General failure during batch status parsing.', error);
    }
    log('debug', `Batch Status Result: ${resultData.successItems.length} success items, ${Object.keys(resultData.errorMessages).length} errors.`);
    log('debug', '--- Finished Batch Status Parsing ---');
    return resultData; // Возвращаем { successItems: [обогащенные], errorMessages: {barcode: msg,...} }
}

module.exports = {
    parseSingleResponse,
    parseTicketResponse,
    parseBatchResponseForStatus
};