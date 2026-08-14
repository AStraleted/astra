# VK SMSCodex app

Готовый минимальный проект для Git.

## Что уже работает

- Telegram-вход из текущего интерфейса.
- Главное меню VK.
- Цена в интерфейсе: 0.8 USDT за номер.
- Выбор количества 1–10.
- Покупка каждого номера через backend `POST /api/buy-vk`.
- Backend отправляет запрос в SMSCodex `POST /api/v1/marketplace/fast-purchase/api`.
- Сервис: `vk`.
- Страна: `0`.
- Максимальная цена закупки: `0.8`.

Получение SMS-кода, complete/cancel и webhook пока не добавлены.

## API-ключ

Вариант 1 — безопаснее: на хостинге задать переменную окружения:

```text
SMSCODEX_API_KEY=api_...
```

Вариант 2 — если вы принципиально хотите, чтобы конфигурация лежала прямо в Git: откройте `config.js` и замените `PASTE_FULL_API_KEY_HERE` на ключ.

**Не публикуйте репозиторий с реальным API-ключом.**

## Запуск

Нужен Node.js 18+.

```bash
npm start
```

По умолчанию сайт доступен на `http://localhost:3000`.

Проверка backend:

```text
GET /health
```

Покупка VK:

```text
POST /api/buy-vk
```

## Git

```bash
git init
git add .
git commit -m "Initial VK SMSCodex app"
git branch -M main
git remote add origin YOUR_GITHUB_REPO_URL
git push -u origin main
```

Для деплоя нужен хостинг, который запускает Node.js из этого Git-репозитория. GitHub Pages сам `server.js` не запускает.
