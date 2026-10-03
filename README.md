# OXY Video Free

Бесплатный MCP-шлюз для коротких игровых image-to-video анимаций.

## Что внутри

- `space/app.py` — Gradio/MCP приложение.
- `space/README.md` — метаданные Hugging Face Space.
- `space/requirements.txt` — зависимости.
- `.github/workflows/deploy-hf-space.yml` — автоматическая публикация в Hugging Face.

Целевой Space: `Almazovski/oxy-video-free`.

## Первый запуск

В GitHub добавь один секрет:

**Settings → Secrets and variables → Actions → New repository secret**

Имя: `HF_TOKEN`

Значение: Hugging Face Access Token с правом **write**.

После этого:

**Actions → Deploy OXY Video Free to Hugging Face → Run workflow**

Дальше каждый push в `main` будет автоматически обновлять Space.
