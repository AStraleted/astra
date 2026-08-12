/**
 * Astraleted.ru -> SMSCodex API proxy for Cloudflare Workers.
 *
 * Secrets / vars to configure in Cloudflare:
 *   SMSCODEX_API_KEY      secret, never put it into index.html
 *   ASTRALETED_USERNAME   secret or encrypted variable
 *   ASTRALETED_PASSWORD   secret
 *   SESSION_SECRET        secret, random string 32+ chars
 *   ALLOWED_ORIGINS       var, comma separated, e.g.
 *                         https://astraleted.ru,https://www.astraleted.ru
 *   MOCK_MODE             optional var "1" for a no-spend demo
 *
 * The worker is deliberately NOT an open proxy: the browser can only call
 * the small allow-listed set of SMSCodex operations below.
 */

const SMSCODEX_BASE = 'https://smscodex.com/api/v1';
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const encoder = new TextEncoder();
const mockOrders = new Map();

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env);

    if (request.method === 'OPTIONS') {
      if (origin && !isAllowedOrigin(origin, env)) {
        return json(
          {
            ok: false,
            error: 'origin_not_allowed',
            message: 'Origin is not allowed.'
          },
          403,
          cors
        );
      }

      return new Response(null, {
        status: 204,
        headers: cors
      });
    }

    if (origin && !isAllowedOrigin(origin, env)) {
      return json(
        {
          ok: false,
          error: 'origin_not_allowed',
          message: 'Запрос с этого домена запрещён.'
        },
        403,
        cors
      );
    }

    const url = new URL(request.url);
    const action = url.searchParams.get('action') || '';

    try {
      if (action === 'health') {
        return json(
          {
            ok: true,
            service: 'astraleted-worker',
            provider_configured: Boolean(env.SMSCODEX_API_KEY),
            mock: env.MOCK_MODE === '1'
          },
          200,
          cors
        );
      }

      if (action === 'bootstrap') {
        const session = await readSession(request, env);

        return json(
          {
            ok: true,
            authenticated: Boolean(session),
            username: session?.sub || '',
            provider_configured:
              env.MOCK_MODE === '1' || Boolean(env.SMSCODEX_API_KEY),
            mock: env.MOCK_MODE === '1'
          },
          200,
          cors
        );
      }

      if (action === 'login') {
        if (request.method !== 'POST') {
          return methodNotAllowed(cors);
        }

        requireAuthConfig(env);

        const body = await readJson(request);
        const username = String(body.username || '').trim();
        const password = String(body.password || '');

        if (!username || !password) {
          return json(
            {
              ok: false,
              error: 'bad_credentials',
              message: 'Введите логин и пароль.'
            },
            401,
            cors
          );
        }

        const validUser = safeEqual(
          username,
          String(env.ASTRALETED_USERNAME || '')
        );

        const validPass = safeEqual(
          password,
          String(env.ASTRALETED_PASSWORD || '')
        );

        if (!validUser || !validPass) {
          await sleep(250);

          return json(
            {
              ok: false,
              error: 'bad_credentials',
              message: 'Неверный логин или пароль.'
            },
            401,
            cors
          );
        }

        const token = await makeSessionToken(username, env);

        return json(
          {
            ok: true,
            username,
            token,
            expires_in: SESSION_TTL_SECONDS
          },
          200,
          cors
        );
      }

      if (action === 'logout') {
        if (request.method !== 'POST') {
          return methodNotAllowed(cors);
        }

        return json({ ok: true }, 200, cors);
      }

      if (action === 'services') {
        return proxyResult(
          await smscodex(
            env,
            'GET',
            '/reference/services',
            {},
            null,
            false
          ),
          cors
        );
      }

      if (action === 'countries') {
        return proxyResult(
          await smscodex(
            env,
            'GET',
            '/reference/countries',
            {},
            null,
            false
          ),
          cors
        );
      }

      const session = await requireSession(request, env, cors);

      if (session instanceof Response) {
        return session;
      }

      if (action === 'balance') {
        return proxyResult(
          await smscodex(env, 'GET', '/wallets/me'),
          cors
        );
      }

      if (action === 'catalog') {
        const query = {
          limit: 30,
          offset: 0
        };

        const service = optionalCode(
          url.searchParams.get('service')
        );

        const country = optionalCode(
          url.searchParams.get('country')
        );

        if (service) {
          query.service = service;
        }

        if (country) {
          query.country = country;
        }

        return proxyResult(
          await smscodex(
            env,
            'GET',
            '/marketplace/catalog',
            query
          ),
          cors
        );
      }

      if (action === 'availability') {
        const query = {
          limit: 50
        };

        const service = optionalCode(
          url.searchParams.get('service')
        );

        const country = optionalCode(
          url.searchParams.get('country')
        );

        const operator = optionalCode(
          url.searchParams.get('operator')
        );

        if (service) {
          query.service = service;
        }

        if (country) {
          query.country = country;
        }

        if (operator) {
          query.operator = operator;
        }

        return proxyResult(
          await smscodex(
            env,
            'GET',
            '/marketplace/availability',
            query
          ),
          cors
        );
      }

      if (action === 'rental-tiers') {
        return proxyResult(
          await smscodex(
            env,
            'GET',
            '/rental/tiers',
            {
              limit: 100,
              offset: 0
            },
            null,
            false
          ),
          cors
        );
      }

      if (action === 'purchase') {
        if (request.method !== 'POST') {
          return methodNotAllowed(cors);
        }

        const body = await readJson(request);

        const serviceCode = requiredCode(
          body.service_code,
          'service_code'
        );

        const country = requiredCode(
          body.country,
          'country'
        );

        const payload = {
          service_code: serviceCode,
          country
        };

        if (body.operator) {
          payload.operator = requiredCode(
            body.operator,
            'operator'
          );
        }

        if (body.rental_tier) {
          payload.rental_tier = requiredCode(
            body.rental_tier,
            'rental_tier'
          );
        }

        if (body.idempotency_key) {
          payload.idempotency_key = requiredCode(
            body.idempotency_key,
            'idempotency_key',
            120
          );
        }

        if (
          body.price_limit !== '' &&
          body.price_limit !== null &&
          body.price_limit !== undefined
        ) {
          const price = Number(body.price_limit);

          if (
            !Number.isFinite(price) ||
            price <= 0 ||
            price > 1000
          ) {
            throw apiError(
              'bad_price_limit',
              'Некорректный лимит цены.',
              422
            );
          }

          payload.price_limit = price;
        }

        return proxyResult(
          await smscodex(
            env,
            'POST',
            '/marketplace/fast-purchase/api',
            {},
            payload
          ),
          cors
        );
      }

      if (action === 'order') {
        if (request.method !== 'GET') {
          return methodNotAllowed(cors);
        }

        const id = orderId(
          url.searchParams.get('id')
        );

        return proxyResult(
          await smscodex(
            env,
            'GET',
            `/marketplace/orders/${encodeURIComponent(id)}`
          ),
          cors
        );
      }

      if (
        action === 'cancel' ||
        action === 'complete'
      ) {
        if (request.method !== 'POST') {
          return methodNotAllowed(cors);
        }

        const body = await readJson(request);
        const id = orderId(body.order_id);

        return proxyResult(
          await smscodex(
            env,
            'POST',
            `/marketplace/orders/${encodeURIComponent(id)}/${action}`
          ),
          cors
        );
      }

      return json(
        {
          ok: false,
          error: 'route_not_found',
          message: 'Неизвестный API route.'
        },
        404,
        cors
      );
    } catch (err) {
      const status = Number(err?.status) || 500;
      const code = String(
        err?.code || 'worker_error'
      );

      const message =
        status >= 500
          ? 'Внутренняя ошибка Astraleted API.'
          : String(
              err?.message || 'Ошибка запроса.'
            );

      console.error(
        'Astraleted worker error',
        code,
        err?.message || err
      );

      return json(
        {
          ok: false,
          error: code,
          message
        },
        status,
        cors
      );
    }
  }
};

function allowedOrigins(env) {
  const configured = String(
    env.ALLOWED_ORIGINS || ''
  )
    .split(',')
    .map(x => x.trim())
    .filter(Boolean);

  if (configured.length) {
    return configured;
  }

  return [
    'https://astraleted.ru',
    'https://www.astraleted.ru',
    'http://localhost:8000',
    'http://127.0.0.1:8000',
    'http://localhost:5500',
    'http://127.0.0.1:5500'
  ];
}

function isAllowedOrigin(origin, env) {
  return allowedOrigins(env).includes(origin);
}

function corsHeaders(origin, env) {
  const h = {
    'Access-Control-Allow-Methods':
      'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers':
      'Authorization, Content-Type, Accept',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  };

  if (
    origin &&
    isAllowedOrigin(origin, env)
  ) {
    h['Access-Control-Allow-Origin'] = origin;
  }

  return h;
}

function json(
  body,
  status = 200,
  extraHeaders = {}
) {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        'Content-Type':
          'application/json; charset=utf-8',
        ...extraHeaders
      }
    }
  );
}

function methodNotAllowed(cors) {
  return json(
    {
      ok: false,
      error: 'method_not_allowed',
      message: 'Метод не поддерживается.'
    },
    405,
    cors
  );
}

function apiError(
  code,
  message,
  status = 400
) {
  const e = new Error(message);
  e.code = code;
  e.status = status;
  return e;
}

async function readJson(request) {
  const type =
    request.headers.get('Content-Type') || '';

  if (
    !type
      .toLowerCase()
      .includes('application/json')
  ) {
    throw apiError(
      'bad_content_type',
      'Ожидается JSON.',
      415
    );
  }

  try {
    const body = await request.json();

    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body)
    ) {
      throw new Error('bad shape');
    }

    return body;
  } catch (_) {
    throw apiError(
      'bad_json',
      'Некорректный JSON.',
      400
    );
  }
}

function requiredCode(
  value,
  field,
  max = 80
) {
  const s = String(value ?? '').trim();

  if (
    !s ||
    s.length > max ||
    !/^[a-zA-Z0-9._:-]+$/.test(s)
  ) {
    throw apiError(
      'bad_parameter',
      `Некорректный параметр ${field}.`,
      422
    );
  }

  return s;
}

function optionalCode(value) {
  if (
    value === null ||
    value === undefined ||
    String(value).trim() === ''
  ) {
    return '';
  }

  return requiredCode(
    value,
    'query'
  );
}

function orderId(value) {
  const id = String(value ?? '').trim();

  if (
    !/^[a-zA-Z0-9-]{16,80}$/.test(id)
  ) {
    throw apiError(
      'bad_order_id',
      'Некорректный ID заказа.',
      422
    );
  }

  return id;
}

function requireAuthConfig(env) {
  if (
    !env.ASTRALETED_USERNAME ||
    !env.ASTRALETED_PASSWORD ||
    !env.SESSION_SECRET ||
    String(env.SESSION_SECRET).length < 32
  ) {
    throw apiError(
      'login_not_configured',
      'На Worker не настроены ASTRALETED_USERNAME, ASTRALETED_PASSWORD и SESSION_SECRET.',
      503
    );
  }
}

async function requireSession(
  request,
  env,
  cors
) {
  const session = await readSession(
    request,
    env
  );

  if (!session) {
    return json(
      {
        ok: false,
        error: 'auth_required',
        message: 'Сначала войдите в кабинет.'
      },
      401,
      cors
    );
  }

  return session;
}

async function readSession(
  request,
  env
) {
  if (
    !env.SESSION_SECRET ||
    String(env.SESSION_SECRET).length < 32
  ) {
    return null;
  }

  const auth =
    request.headers.get('Authorization') || '';

  const match = auth.match(
    /^Bearer\s+(.+)$/i
  );

  if (!match) {
    return null;
  }

  return verifySessionToken(
    match[1],
    env
  );
}

async function makeSessionToken(
  username,
  env
) {
  requireAuthConfig(env);

  const now =
    Math.floor(Date.now() / 1000);

  const payload = {
    sub: username,
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
    n: crypto.randomUUID()
  };

  const encoded = base64urlEncode(
    encoder.encode(
      JSON.stringify(payload)
    )
  );

  const key = await hmacKey(
    env.SESSION_SECRET,
    ['sign']
  );

  const sig =
    await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(encoded)
    );

  return `${encoded}.${base64urlEncode(
    new Uint8Array(sig)
  )}`;
}

async function verifySessionToken(
  token,
  env
) {
  try {
    const [
      payloadPart,
      sigPart,
      extra
    ] = String(token).split('.');

    if (
      !payloadPart ||
      !sigPart ||
      extra !== undefined
    ) {
      return null;
    }

    const key = await hmacKey(
      env.SESSION_SECRET,
      ['verify']
    );

    const ok =
      await crypto.subtle.verify(
        'HMAC',
        key,
        base64urlDecode(sigPart),
        encoder.encode(payloadPart)
      );

    if (!ok) {
      return null;
    }

    const payload = JSON.parse(
      new TextDecoder().decode(
        base64urlDecode(payloadPart)
      )
    );

    const now =
      Math.floor(Date.now() / 1000);

    if (
      !payload?.sub ||
      !Number.isFinite(payload.exp) ||
      payload.exp <= now
    ) {
      return null;
    }

    return payload;
  } catch (_) {
    return null;
  }
}

async function hmacKey(
  secret,
  usages
) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(
      String(secret)
    ),
    {
      name: 'HMAC',
      hash: 'SHA-256'
    },
    false,
    usages
  );
}

function base64urlEncode(bytes) {
  let binary = '';

  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64urlDecode(value) {
  const normalized = value
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const padded =
    normalized +
    '='.repeat(
      (
        4 -
        (
          normalized.length % 4 || 4
        )
      ) % 4
    );

  const binary = atob(padded);

  const bytes =
    new Uint8Array(binary.length);

  for (
    let i = 0;
    i < binary.length;
    i++
  ) {
    bytes[i] =
      binary.charCodeAt(i);
  }

  return bytes;
}

function safeEqual(a, b) {
  const left =
    encoder.encode(String(a));

  const right =
    encoder.encode(String(b));

  if (
    left.length !== right.length
  ) {
    return false;
  }

  let diff = 0;

  for (
    let i = 0;
    i < left.length;
    i++
  ) {
    diff |= left[i] ^ right[i];
  }

  return diff === 0;
}

async function smscodex(
  env,
  method,
  path,
  query = {},
  body = null,
  requiresKey = true
) {
  if (env.MOCK_MODE === '1') {
    return mockSmscodex(
      method,
      path,
      query,
      body
    );
  }

  if (
    requiresKey &&
    !env.SMSCODEX_API_KEY
  ) {
    return [
      503,
      {
        error: 'server_not_configured',
        message:
          'На Worker не задан SMSCODEX_API_KEY.'
      }
    ];
  }

  const url = new URL(
    SMSCODEX_BASE + path
  );

  for (
    const [k, v]
    of Object.entries(query)
  ) {
    if (
      v !== undefined &&
      v !== null &&
      v !== ''
    ) {
      url.searchParams.set(
        k,
        String(v)
      );
    }
  }

  const headers = {
    Accept: 'application/json'
  };

  if (
    requiresKey &&
    env.SMSCODEX_API_KEY
  ) {
    headers['X-API-Key'] =
      String(
        env.SMSCODEX_API_KEY
      );
  }

  const init = {
    method,
    headers
  };

  if (body !== null) {
    headers['Content-Type'] =
      'application/json';

    init.body =
      JSON.stringify(body);
  }

  let response;

  try {
    response =
      await fetch(url, init);
  } catch (err) {
    return [
      502,
      {
        error: 'upstream_network',
        message:
          'Не удалось соединиться с SMSCodex.'
      }
    ];
  }

  const text =
    await response.text();

  let data = {};

  if (text) {
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = {
        raw: text.slice(0, 2000)
      };
    }
  }

  return [
    response.status,
    data
  ];
}

function proxyResult(
  [status, data],
  cors
) {
  return json(
    {
      ok:
        status >= 200 &&
        status < 300,
      data
    },
    status || 502,
    cors
  );
}

function mockSmscodex(
  method,
  path,
  query,
  body
) {
  if (
    path === '/reference/services'
  ) {
    return [
      200,
      {
        items: [
          {
            key: 'tg',
            name: 'Telegram'
          },
          {
            key: 'wa',
            name: 'WhatsApp'
          },
          {
            key: 'vk',
            name: 'VK'
          },
          {
            key: 'go',
            name: 'Google'
          },
          {
            key: 'ds',
            name: 'Discord'
          },
          {
            key: 'ig',
            name: 'Instagram'
          }
        ]
      }
    ];
  }

  if (
    path === '/reference/countries'
  ) {
    return [
      200,
      {
        items: [
          {
            id: 0,
            rus: 'Россия',
            eng: 'Russia'
          },
          {
            id: 12,
            rus: 'США',
            eng: 'United States'
          },
          {
            id: 2,
            rus: 'Казахстан',
            eng: 'Kazakhstan'
          },
          {
            id: 16,
            rus: 'Великобритания',
            eng: 'United Kingdom'
          }
        ]
      }
    ];
  }

  if (
    path === '/wallets/me'
  ) {
    return [
      200,
      {
        currency: 'USD',
        balance: '27.42',
        updated_at:
          new Date().toISOString()
      }
    ];
  }

  if (
    path ===
    '/marketplace/availability'
  ) {
    return [
      200,
      {
        items: [
          {
            service:
              query.service || 'tg',

            country:
              query.country || '0',

            operators: [
              'mts',
              'beeline'
            ],

            available: 84,
            min_price: '0.22',
            max_price: '0.95',
            avg_price: '0.31',
            service_name: 'Telegram',
            display_name: 'Telegram',

            price_points: [
              {
                price: '0.22',
                count: 40
              },
              {
                price: '0.25',
                count: 44
              }
            ]
          }
        ],
        total: 1
      }
    ];
  }

  if (
    path ===
    '/marketplace/catalog'
  ) {
    return [
      200,
      {
        items: [
          {
            service_id:
              query.service || 'tg',

            service_slug:
              query.service || 'tg',

            service_name:
              String(
                query.service || 'tg'
              ).toUpperCase(),

            country:
              query.country || '0',

            country_title:
              'Mock country',

            base_price: '0.22',
            currency: 'USD'
          }
        ]
      }
    ];
  }

  if (
    path === '/rental/tiers'
  ) {
    return [
      200,
      {
        items: [
          {
            key: '1h',
            label: '1 час',
            duration_minutes: 60
          },
          {
            key: '24h',
            label: '24 часа',
            duration_minutes: 1440
          }
        ],
        total: 2
      }
    ];
  }

  if (
    path ===
      '/marketplace/fast-purchase/api' &&
    method === 'POST'
  ) {
    const id =
      crypto.randomUUID();

    const now = Date.now();

    const order = {
      order_id: id,
      order_status:
        'awaiting_confirmation',

      service:
        body?.service_code || 'tg',

      country:
        body?.country || '0',

      operator:
        body?.operator || 'mts',

      price: '0.22',
      currency: 'USD',
      phone_number:
        '79001234567',

      expires_at:
        new Date(
          now + 20 * 60 * 1000
        ).toISOString(),

      created_at:
        new Date(now).toISOString(),

      _mock_created: now
    };

    mockOrders.set(
      id,
      order
    );

    return [
      201,
      publicMockOrder(order)
    ];
  }

  const match =
    path.match(
      /^\/marketplace\/orders\/([a-zA-Z0-9-]+)(?:\/(cancel|complete))?$/
    );

  if (match) {
    const id = match[1];
    const sub = match[2] || '';

    let order =
      mockOrders.get(id);

    if (!order) {
      return [
        404,
        {
          error: 'not_found',
          message:
            'Mock order not found.'
        }
      ];
    }

    if (
      sub === 'cancel' &&
      method === 'POST'
    ) {
      if (order.last_code) {
        return [
          400,
          {
            error:
              'already_completed',
            message:
              'Код уже получен.'
          }
        ];
      }

      order = {
        ...order,
        order_status:
          'cancelled'
      };

      mockOrders.set(
        id,
        order
      );
    } else if (
      sub === 'complete' &&
      method === 'POST'
    ) {
      order = {
        ...order,
        order_status:
          'completed',
        completed_at:
          new Date().toISOString()
      };

      mockOrders.set(
        id,
        order
      );
    } else if (
      !sub &&
      Date.now() -
        order._mock_created >=
        12000 &&
      ![
        'cancelled',
        'completed'
      ].includes(
        order.order_status
      )
    ) {
      order = {
        ...order,
        order_status:
          'completed',

        completed_at:
          new Date().toISOString(),

        last_code:
          '589613',

        sms: [
          {
            code: '589613',
            sender: 'Telegram',
            received_at:
              new Date().toISOString()
          }
        ]
      };

      mockOrders.set(
        id,
        order
      );
    }

    return [
      200,
      publicMockOrder(order)
    ];
  }

  return [
    404,
    {
      error:
        'mock_route_not_found',
      message:
        'Mock route not found.'
    }
  ];
}

function publicMockOrder(
  order
) {
  const copy = {
    ...order
  };

  delete copy._mock_created;

  return copy;
}

function sleep(ms) {
  return new Promise(
    resolve =>
      setTimeout(resolve, ms)
  );
}
