const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const PORT = Number(process.env.PORT || 3000);
const SMSCODEX_PURCHASE_URL =
  `${config.SMSCODEX_BASE_URL}/api/v1/marketplace/fast-purchase/api`;

function sendJson(res, status, data) {
  const body = JSON.stringify(data);

  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });

  res.end(body);
}

function getApiKey() {
  return String(config.SMSCODEX_API_KEY || '').trim();
}

function hasValidApiKey() {
  const key = getApiKey();
  return Boolean(
    key &&
    key !== 'PASTE_FULL_API_KEY_HERE' &&
    !key.includes('***')
  );
}

async function buyVk(req, res) {
  if (!hasValidApiKey()) {
    return sendJson(res, 500, {
      message: 'SMSCodex API-ключ не настроен. Укажите его в config.js или SMSCODEX_API_KEY.'
    });
  }

  try {
    const upstream = await fetch(SMSCODEX_PURCHASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-API-Key': getApiKey()
      },
      body: JSON.stringify({
        service_code: config.VK_SERVICE_CODE,
        country: config.VK_COUNTRY,
        price_limit: config.VK_PRICE_LIMIT
      })
    });

    const text = await upstream.text();
    let data;

    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { message: text || 'Пустой ответ SMSCodex' };
    }

    if (!upstream.ok) {
      console.error('SMSCodex error:', upstream.status, data);
    }

    return sendJson(res, upstream.status, data);
  } catch (error) {
    console.error('SMSCodex request failed:', error);

    return sendJson(res, 502, {
      message: 'Сервер не смог подключиться к SMSCodex.',
      detail: error?.message || String(error)
    });
  }
}

function serveIndex(res) {
  const file = path.join(__dirname, 'index.html');

  fs.readFile(file, (error, data) => {
    if (error) {
      res.writeHead(500, {
        'Content-Type': 'text/plain; charset=utf-8'
      });
      res.end('Не найден index.html рядом с server.js');
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, {
      ok: true,
      apiKeyConfigured: hasValidApiKey()
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/buy-vk') {
    return buyVk(req, res);
  }

  if (
    req.method === 'GET' &&
    (url.pathname === '/' || url.pathname === '/index.html')
  ) {
    return serveIndex(res);
  }

  res.writeHead(404, {
    'Content-Type': 'text/plain; charset=utf-8'
  });
  res.end('Not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`SMSCodex key configured: ${hasValidApiKey() ? 'yes' : 'no'}`);
});
