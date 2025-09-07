const https = require('https');
const fs = require('fs');
const { HttpsProxyAgent } = require('https-proxy-agent');
const tunnel = require('tunnel');
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);

// Конфигурация прокси
const proxyConfig = {
  host: 'mwg.corp.ingos.ru',
  port: 9090,
  username: process.env.USERNAME || 'karenkikh',
  domain: process.env.USERDOMAIN || 'corp.ingos.ru',
};

// URL целевого сервиса
const targetUrl = 'https://tracking.pochta.ru/';

// Пользовательский User-Agent
const customUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

// Функция для получения токена SPNEGO
async function getSpnegoToken(spn) {
  try {
    const command = `
      Add-Type -AssemblyName System.IdentityModel
      $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
      $tokenBytes = $identity.GetTokenBytes()
      $base64Token = [Convert]::ToBase64String($tokenBytes)
      Write-Output $base64Token
    `;
    
    const { stdout, stderr } = await exec(`powershell -Command "${command}"`);
    if (stderr) {
      console.error('Ошибка при получении токена:', stderr);
      return null;
    }
    
    return stdout.trim();
  } catch (error) {
    console.error('Не удалось получить токен SPNEGO:', error);
    return null;
  }
}

// Функция для выполнения запроса с поддержкой Negotiate
async function makeRequestWithNegotiate() {
  return new Promise(async (resolve, reject) => {
    try {
      console.log('Начало процесса аутентификации Negotiate...');
      
      const parsedUrl = new URL(targetUrl);
      
      const tunnelingAgent = tunnel.httpsOverHttp({
        proxy: {
          host: proxyConfig.host,
          port: proxyConfig.port
        },
        rejectUnauthorized: false
      });
      
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          'User-Agent': customUserAgent,
          'Host': parsedUrl.hostname
        },
        agent: tunnelingAgent
      };
      
      console.log('Отправка первоначального запроса для получения вызова аутентификации...');
      
      const req = https.request(options, (res) => {
        let responseBody = '';
        
        res.on('data', (chunk) => {
          responseBody += chunk;
        });
        
        res.on('end', async () => {
          if (res.statusCode === 407) {
            console.log('Получен статус 407: Требуется аутентификация прокси');
            
            const proxyAuthenticateHeader = res.headers['proxy-authenticate'];
            console.log('Заголовок Proxy-Authenticate:', proxyAuthenticateHeader);
            
            if (!proxyAuthenticateHeader) {
              return reject(new Error('Прокси требует аутентификацию, но не предоставил заголовок Proxy-Authenticate'));
            }
            
            if (!proxyAuthenticateHeader.includes('Negotiate')) {
              return reject(new Error(`Прокси не поддерживает Negotiate аутентификацию. Поддерживаемые методы: ${proxyAuthenticateHeader}`));
            }
            
            console.log('Получение токена SPNEGO...');
            const spnegoToken = await getSpnegoToken(`HTTP/${proxyConfig.host}`);
            
            if (!spnegoToken) {
              return reject(new Error('Не удалось получить токен SPNEGO'));
            }
            
            console.log('Токен SPNEGO получен. Отправка аутентифицированного запроса...');
            
            const authOptions = {
              ...options,
              headers: {
                ...options.headers,
                'Proxy-Authorization': `Negotiate ${spnegoToken}`
              }
            };
            
            const authReq = https.request(authOptions, (authRes) => {
              let authResponseBody = '';
              
              authRes.on('data', (chunk) => {
                authResponseBody += chunk;
              });
              
              authRes.on('end', () => {
                if (authRes.statusCode === 407) {
                  console.log('Получен статус 407 после отправки токена. Требуется дополнительный обмен...');
                  return reject(new Error('Многоэтапная аутентификация не реализована в этом скрипте'));
                } else {
                  console.log('Статус ответа после аутентификации:', authRes.statusCode);
                  console.log('Заголовки ответа:', authRes.headers);
                  console.log('Длина полученного HTML:', authResponseBody.length);
                  
                  if (authResponseBody.length > 0) {
                    console.log('Первые 200 символов ответа:', authResponseBody.substring(0, 200));
                    
                    fs.writeFile('response.html', authResponseBody, (err) => {
                      if (err) {
                        console.error('Ошибка при сохранении ответа в файл:', err);
                      } else {
                        console.log('Ответ сохранен в файл response.html');
                      }
                    });
                  }
                  
                  resolve({
                    success: authRes.statusCode !== 407,
                    status: authRes.statusCode,
                    headers: authRes.headers,
                    body: authResponseBody
                  });
                }
              });
            });
            
            authReq.on('error', (error) => {
              console.error('Ошибка при выполнении аутентифицированного запроса:', error);
              reject(error);
            });
            
            authReq.end();
          } else {
            console.log('Статус ответа:', res.statusCode);
            console.log('Заголовки ответа:', res.headers);
            console.log('Длина полученного HTML:', responseBody.length);
            
            if (responseBody.length > 0) {
              console.log('Первые 200 символов ответа:', responseBody.substring(0, 200));
            }
            
            resolve({
              success: res.statusCode !== 407,
              status: res.statusCode,
              headers: res.headers,
              body: responseBody
            });
          }
        });
      });
      
      req.on('error', (error) => {
        console.error('Ошибка при выполнении первоначального запроса:', error);
        if (error.code === 'ETIMEDOUT') {
          console.log('\nСовет: Попробуйте увеличить время ожидания соединения');
        }
        reject(error);
      });
      
      req.setTimeout(30000, () => {
        req.destroy();
        reject(new Error('Превышено время ожидания запроса (30 секунд)'));
      });
      
      req.end();
    } catch (error) {
      console.error('Произошла ошибка:', error);
      reject(error);
    }
  });
}

// Функция для проверки доступности прокси
async function checkProxyAvailability() {
  return new Promise((resolve) => {
    const socket = require('net').createConnection({
      host: proxyConfig.host,
      port: proxyConfig.port,
      timeout: 5000
    }, () => {
      console.log(`Прокси ${proxyConfig.host}:${proxyConfig.port} доступен`);
      socket.end();
      resolve(true);
    });
    
    socket.on('error', (err) => {
      console.error(`Не удалось подключиться к прокси ${proxyConfig.host}:${proxyConfig.port}:`, err.message);
      resolve(false);
    });
    
    socket.on('timeout', () => {
      console.error(`Таймаут при подключении к прокси ${proxyConfig.host}:${proxyConfig.port}`);
      socket.destroy();
      resolve(false);
    });
  });
}

// Главная функция
async function main() {
  console.log('Начало проверки доступа к tracking.pochta.ru через прокси с Negotiate аутентификацией');
  console.log(`Прокси: ${proxyConfig.host}:${proxyConfig.port}`);
  console.log(`User-Agent: ${customUserAgent}`);
  
  try {
    const isProxyAvailable = await checkProxyAvailability();
    
    if (!isProxyAvailable) {
      console.error('Прокси-сервер недоступен. Проверьте настройки сети и прокси.');
      return;
    }
    
    console.log('\n--- Попытка использования Negotiate аутентификации ---');
    const result = await makeRequestWithNegotiate();
    
    if (result.success) {
      console.log('\nДоступ УСПЕШЕН: Соединение с сервисом установлено.');
      console.log(`Статус ответа: ${result.status}`);
      console.log(`Размер полученного контента: ${result.body.length} байт`);
    } else {
      console.log('\nДоступ НЕ ПОЛУЧЕН: Не удалось подключиться к сервису.');
      console.log(`Статус ответа: ${result.status}`);
    }
  } catch (error) {
    console.error('\nДоступ НЕ ПОЛУЧЕН: Не удалось подключиться к сервису.');
    console.error(`Причина ошибки: ${error.message}`);
    
    console.log('\nСоветы по устранению неполадок:');
    console.log('1. Убедитесь, что вы вошли в домен Windows с правильными учетными данными');
    console.log('2. Проверьте настройки прокси-сервера и его доступность');
    console.log('3. Убедитесь, что прокси-сервер поддерживает Negotiate аутентификацию');
    console.log('4. Проверьте, что у вас есть действительный Kerberos-билет (выполните klist в командной строке)');
    console.log('5. Попробуйте обновить Kerberos-билет (выполните kinit в командной строке)');
    console.log('6. Обратитесь к системному администратору для получения точных инструкций по настройке прокси');
  }
}

// Запуск главной функции
main();
