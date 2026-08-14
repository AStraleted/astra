module.exports = {
  // Можно оставить ключ в переменной окружения SMSCODEX_API_KEY.
  // Если принципиально хотите хранить всё в Git, вставьте полный ключ сюда.
  // В ПУБЛИЧНЫЙ репозиторий реальный ключ коммитить нельзя.
  SMSCODEX_API_KEY: process.env.SMSCODEX_API_KEY || 'PASTE_FULL_API_KEY_HERE',

  SMSCODEX_BASE_URL: 'https://smscodex.com',
  VK_SERVICE_CODE: 'vk',
  VK_COUNTRY: '0',
  VK_PRICE_LIMIT: 0.8
};
