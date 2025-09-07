// logger.js
// Модуль логирования с маскированием

const fs = require('fs').promises;
const fsSync = require('fs'); // Synchronous fs for initial check
const path = require('path');
// config будет передан через setLogDirectory
let logDirectory = path.join(__dirname, 'logs'); // Default
let isLogDirEnsured = false;

// Функция для установки директории логов (вызывается из server.js)
function setLogDirectory(dir) {
    logDirectory = dir;
    console.log(`[INFO] Log directory set to: ${logDirectory}`);
}

// Синхронная проверка/создание для старта сервера
function ensureLogDirSync() {
    if (isLogDirEnsured) return;
    console.log(`[INFO] Checking log directory: ${logDirectory}`);
    try {
        if (!fsSync.existsSync(logDirectory)) {
            console.log(`[INFO] Log directory not found, creating synchronously...`);
            fsSync.mkdirSync(logDirectory, { recursive: true });
            console.log(`[INFO] Created log directory: ${logDirectory}`);
        } else {
             console.log(`[INFO] Log directory ${logDirectory} exists.`);
        }
        // Проверка прав на запись
        const testFile = path.join(logDirectory, '_startup_test.log');
        fsSync.writeFileSync(testFile, new Date().toISOString());
        fsSync.unlinkSync(testFile);
        console.log(`[INFO] Write access to log directory confirmed.`);

        isLogDirEnsured = true;
        console.log(`[INFO] Log directory check passed.`);
    } catch (error) {
        console.error(`FATAL: Error ensuring log directory ${logDirectory}. Check permissions.`, error);
        process.exit(1); // Критическая ошибка при старте
    }
}

// Функция маскирования
function maskCredentials(data) {
    let dataString = '';
    if (typeof data === 'string') {
        dataString = data;
    } else {
        try { dataString = JSON.stringify(data); }
        catch (e) { console.error("[Logger] Failed to stringify data for masking:", data); return "[Unmaskable Data]"; }
    }
    // Маскирование XML тегов
    let maskedData = dataString.replace(/<data:login>.*?<\/data:login>/gs, '<data:login>***</data:login>')
                         .replace(/<login>.*?<\/login>/gs, '<login>***</login>')
                         .replace(/<data:password>.*?<\/data:password>/gs, '<data:password>***</data:password>')
                         .replace(/<password>.*?<\/password>/gs, '<password>***</password>');
    // Маскирование JSON строк
    maskedData = maskedData.replace(/"login"\s*:\s*"[^"]+"/g, '"login": "***"')
                           .replace(/"password"\s*:\s*"[^"]+"/g, '"password": "***"');
    return maskedData;
}

// Асинхронная запись в лог
async function logToFile(type, message, data) {
    if (!isLogDirEnsured) {
        // Log to console if directory wasn't ensured (e.g., during early startup errors)
        console.error(`[${new Date().toISOString()}] [${type.toUpperCase()}] [LOGDIR_ERROR] ${maskCredentials(message)}`, (data !== undefined && data !== null) ? maskCredentials(data) : '');
        return;
    }
    try {
        const timestamp = new Date().toISOString();
        const logDate = timestamp.split('T')[0];
        const logFile = path.join(logDirectory, `${type}_${logDate}.log`);
        const maskedMessage = maskCredentials(message);
        // Only include data string if data is provided and not null/undefined
        const maskedDataString = (data !== undefined && data !== null) ? maskCredentials(data) : null;

        let logMessage = `[${timestamp}] [${type.toUpperCase()}] ${maskedMessage}\n`;
        if (maskedDataString !== null) {
            logMessage += maskedDataString + '\n'; // Add data on a new line
        }
        await fs.appendFile(logFile, logMessage + '---\n'); // Add separator

        // Console logging (controlled by environment or config later if needed)
        // Always log errors and warnings to console
        if (['error', 'warn', 'info', 'debug'].includes(type.toLowerCase()) || message.includes('Server started')) {
             const consoleMessage = (type === 'debug' && data !== undefined && data !== null) ? message : maskedMessage; // Show original for debug if needed
             console.log(`[${timestamp}] [${type.toUpperCase()}] ${consoleMessage}` + ((type === 'debug' && data) ? ' (See file for full data)' : ''));
        }
    } catch (err) {
        // Log error about logging failure to console
        console.error(`[${new Date().toISOString()}] [ERROR] Failed to write to log file ${path.join(logDirectory, '...')}:`, err);
    }
}

module.exports = {
    setLogDirectory,
    ensureLogDirSync,
    log: logToFile // Export the logging function as 'log'
};
