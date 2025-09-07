// server.js (Main file - FINAL v6)

// --- Core Modules & Dependencies ---
const path = require('path');
const fs = require('fs'); // Sync fs for startup check
const fsPromises = require('fs').promises; // Async fs for runtime
const express = require('express');
const bodyParser = require('body-parser');

// --- Load Modules ---
const config = require('./config');
const logger = require('./logger');
logger.setLogDirectory(config.logDir); // Pass log directory path
const { log, ensureLogDirSync } = logger; // Use log function after setting dir

const { validateCredentials, validateSingleTrack, validateBatchTrack, validateTicket, ApiError, BatchNotReadyError, ParsingError } = require('./utils');
const RussianPostApiClient = require('./russianPostApiClient');

// --- Инициализация ---
const app = express();
const apiClient = new RussianPostApiClient(); // Create API client instance

// --- Middleware ---
app.use(bodyParser.json({ limit: '50mb' })); // Increase limit if needed for large batch requests
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files from 'public' directory

// --- API Endpoints ---

// Endpoint for Single Tracking
app.post('/track/single', async (req, res, next) => {
    const { login, password, barcode } = req.body;
    log('info', `Request received: POST /track/single for ${barcode}`);
    if (!validateCredentials(login, password) || !validateSingleTrack(barcode)) {
        return res.status(400).json({ success: false, error: 'Логин, пароль и трек-номер обязательны.' });
    }
    try {
        log('debug', 'Calling apiClient.getSingleHistory...');
        // API client now returns enriched data directly from the parser
        const enrichedResultData = await apiClient.getSingleHistory(login, password, barcode);
        log('debug', `apiClient.getSingleHistory finished. Result length: ${enrichedResultData?.length ?? 'undefined'}`);
        res.json({ success: true, data: enrichedResultData }); // Send enriched data
        log('info', `Success response sent for /track/single ${barcode}.`);
    } catch (error) {
        log('error', `Error caught in /track/single endpoint for ${barcode}: ${error.message}`);
        next(error); // Pass error to global handler
    }
});

// Endpoint to Request a Batch Ticket
app.post('/track/batch/ticket', async (req, res, next) => {
     const { login, password, barcodes } = req.body;
     log('info', `Request received: POST /track/batch/ticket for ${barcodes?.length || 0} barcodes.`);
     if (!validateCredentials(login, password) || !validateBatchTrack(barcodes)) {
         return res.status(400).json({ success: false, error: 'Логин, пароль и массив трек-номеров обязательны.' });
     }
     try {
         const ticket = await apiClient.getTicket(login, password, barcodes);
         res.json({ success: true, ticket: ticket });
     } catch (error) {
         next(error); // Pass error to global handler
     }
});

// Endpoint to Get Batch Results (Status and Enriched Data)
app.post('/track/batch/result', async (req, res, next) => {
    const { login, password, ticket } = req.body;
    log('info', `Request received: POST /track/batch/result for ticket ${ticket}`);
    if (!validateCredentials(login, password) || !validateTicket(ticket)) {
        return res.status(400).json({ success: false, error: 'Логин, пароль и тикет обязательны.' });
    }
    try {
        // getBatchStatus now returns { successItems: [enriched], errorMessages: {} }
        const statusResult = await apiClient.getBatchStatus(login, password, ticket);
        res.json({ success: true, data: statusResult }); // Send the structured result
    } catch (error) {
        if (error instanceof BatchNotReadyError) {
            log('info', `Status: Batch results for ticket ${ticket} are not ready yet.`);
            // Send 202 Accepted status to indicate processing
            return res.status(202).json({ success: false, status: 'PROCESSING', message: error.message });
        }
        next(error); // Pass other errors to global handler
    }
});

// --- Log Management Endpoints ---
app.get('/logs/check', async (req, res) => {
    try {
        await fsPromises.access(config.logDir, fs.constants.R_OK | fs.constants.W_OK);
        res.sendStatus(200); // OK, directory accessible
    } catch (error) {
        log('error', `Log directory check failed for /logs/check: ${error.message}`);
        res.sendStatus(503); // Service Unavailable
    }
});

app.get('/logs', async (req, res, next) => {
    log('debug', 'Request received for GET /logs');
    try {
        await fsPromises.access(config.logDir, fs.constants.R_OK);
        const logFiles = await fsPromises.readdir(config.logDir);
        const today = new Date().toISOString().split('T')[0];
        // Filter for today's logs and sort by type (error first)
        const relevantFiles = logFiles
            .filter(f => f.endsWith('.log') && f.includes(today))
            .sort((a, b) => {
                const priority = {'error':1,'warn':2,'info':3,'debug':4};
                return (priority[a.split('_')[0]] || 99) - (priority[b.split('_')[0]] || 99);
            });

        let allLogEntries = [];
        for (const file of relevantFiles) {
             const type = file.split('_')[0];
             const filePath = path.join(config.logDir, file);
             try {
                 const content = await fsPromises.readFile(filePath, 'utf-8');
                 // Parse log entries (assuming format [timestamp] [TYPE] message\n---\n)
                 const entries = content.split('---\n') // Split by separator
                               .filter(Boolean) // Remove empty entries
                               .reverse() // Show newest first within the file
                               .map(entry => {
                                   // Regex to capture timestamp, type, and message
                                   const match = entry.match(/^\[(.*?)\]\s\[(.*?)\]\s([\s\S]*)/);
                                   if (match) {
                                       return { timestamp: match[1], type: match[2].toLowerCase(), message: match[3].trim() };
                                   }
                                   return null; // Ignore lines that don't match
                               })
                               .filter(Boolean); // Remove nulls
                 allLogEntries.push(...entries);
             } catch (readErr) {
                 // Ignore if file disappeared between readdir and readFile, log other errors
                 if (readErr.code !== 'ENOENT') {
                     log('warn', `Could not read log file ${file}: ${readErr.message}`);
                 }
             }
        }
        // Sort all entries by timestamp descending (newest first overall)
        allLogEntries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        // Limit the number of entries sent to the client
        const limitedEntries = allLogEntries.slice(0, config.maxLogLines);
        res.json(limitedEntries);
    } catch (error) {
        log('error', `Failed to retrieve logs: ${error.message}`, error.stack);
        if (error.code === 'ENOENT' || error.code === 'EACCES') {
            next(new Error(`Cannot access log directory (${config.logDir}). Check existence and permissions.`));
        } else {
            next(error); // Pass other errors to global handler
        }
    }
});

app.post('/logs/clear', async (req, res, next) => {
    log('info', 'Request: Clear logs');
    try {
        await fsPromises.access(config.logDir, fs.constants.R_OK | fs.constants.W_OK);
        const logFiles = await fsPromises.readdir(config.logDir);
        const today = new Date().toISOString().split('T')[0];
        let clearedCount = 0;
        let failedCount = 0;
        const clearPromises = logFiles.map(async (file) => {
            // Clear only today's log files
            if (file.endsWith('.log') && file.includes(today)) {
                 const filePath = path.join(config.logDir, file);
                 try {
                     await fsPromises.truncate(filePath, 0); // Empty the file
                     clearedCount++;
                 } catch (clearErr) {
                     log('error', `Failed to clear log file ${file}: ${clearErr.message}`);
                     failedCount++;
                 }
            }
        });
        await Promise.all(clearPromises);
        const message = `Логи за сегодня (${clearedCount} файлов) очищены.` + (failedCount > 0 ? ` Не удалось очистить ${failedCount} файлов.` : '');
        log('info', `Log clearing finished. ${message}`);
        res.json({ success: true, message: message });
    } catch (error) {
        log('error', `Failed to list/clear logs: ${error.message}`, error.stack);
         if (error.code === 'ENOENT' || error.code === 'EACCES') {
             next(new Error(`Cannot access log directory (${config.logDir}) for clearing. Check existence and permissions.`));
         } else {
             next(error); // Pass other errors
         }
    }
});


// --- Global Error Handler ---
app.use((err, req, res, next) => {
    // Log the full error details server-side
    log('error', `Unhandled error on ${req.method} ${req.path}: ${err.message}`, err.stack);

    let statusCode = 500; // Default Internal Server Error
    let clientMessage = 'Внутренняя ошибка сервера.';

    // Set status and message based on custom error types
    if (err instanceof ApiError) {
        statusCode = err.statusCode || 502; // Bad Gateway or original status
        clientMessage = err.message; // Use the specific API error message
    } else if (err instanceof ParsingError) {
        statusCode = 500;
        clientMessage = `Ошибка обработки ответа: ${err.message}`;
    } else if (err instanceof BatchNotReadyError) {
        // This should ideally be caught earlier, but handle just in case
        statusCode = 202; // Accepted
        clientMessage = err.message;
        return res.status(statusCode).json({ success: false, status: 'PROCESSING', message: clientMessage });
    } else if (err.message.includes('Cannot access log directory')) {
        statusCode = 503; // Service Unavailable
        clientMessage = err.message;
    }
    // Add more specific error type checks if needed

    // Prevent sending response if headers already sent
    if (res.headersSent) {
        return next(err); // Pass to default Express error handler
    }

    // Send JSON error response
    res.status(statusCode).json({ success: false, error: clientMessage });
});

// --- Server Start ---
try {
    // *** Use synchronous ensureLogDirSync from logger ***
    ensureLogDirSync();
    // If directory check passes, start the server
    app.listen(config.port, () => {
        console.log(`Server running on http://localhost:${config.port}`);
        log('info', `Server started successfully on port ${config.port}.`); // Use logger
    });
} catch (startupError) {
     // Log startup error to console (logger might not be fully ready)
     console.error("FATAL: Server failed to start during initial synchronous setup.", startupError);
     process.exit(1); // Exit if critical setup fails
}