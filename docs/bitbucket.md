## Создание PAT-токена для Bitbucket

**Рекомендуемый способ авторизации:** Bearer Token (PAT) — Personal Access Token (PAT), токен личного доступа Bitbucket Server/DC.

1. В Bitbucket откройте аватар в правом верхнем углу

2. Перейдите в `Manage account` → `Personal access tokens`

3. Нажмите `Create token`

4. **Необходимые права:** `Project read` + `Repository read` (минимум); добавьте `Repository write`, если используются write-инструменты

5. Используйте полученный токен в конфигурации `BITBUCKET_TOKEN`

Этот токен передаётся через переменную `BITBUCKET_TOKEN` и должен покрывать как чтение проектов и репозиториев, так и запись при использовании write-инструментов.
