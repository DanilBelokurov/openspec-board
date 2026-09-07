## Создание PAT-токена с полными разрешениями

**Важное предусловие:** Стандартный токен, созданный в UI SourceControl (`https://sc-ci.sber.ru/sc/user/settings/applications`), может не иметь всех необходимых разрешений для работы через API. Если вы получаете ошибки 403 Forbidden, создайте персональный токен через API:

1. Перейдите на Swagger UI SourceControl: `https://sc-ci.sber.ru/sc/api/swagger_v3/#/user`
2. Авторизуйтесь токеном из `https://sc-ci.sber.ru/sc/user/settings/applications`
3. Вызовите метод `POST /user/tokens Create personal token` со следующим телом:

```json
{
  "name": "token1",
  "scopes": [
    "read:repo_hook",
    "user",
    "repo"
  ]
}
```

4. В ответе получите объект с полем `sha1` — это ваш PAT-токен с полными разрешениями

5. Используйте этот `sha1` токен в конфигурации `SC_TOKEN`

Этот токен будет иметь все необходимые разрешения (`read:repo_hook`, `user`, `repo`) и должен работать без ошибок 403.
