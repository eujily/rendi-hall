# ADR-003: Стек и доставка — Vite + vanilla JS + three.js + GSAP, статика на GitHub Pages

**Status:** Accepted
**Date:** 2026-10-09
**Deciders:** Жека

## Context

Портфолио-концепт: без бэкенда, без LLM, ссылка открывается заказчиком в
браузере. Работу пишут параллельно 6+ Sonnet-агентов — нужна минимальная
связность и минимум фреймворкового клея. На машине Node 24 стоит в
`~/.local/node` вне PATH.

## Decision

- Vite 6 + vanilla ES-модули (без React/R3F).
- three.js (r17x) + GSAP 3 (таймлайны камеры и clip-path).
- Модули общаются через event bus (`core/events.js`), не импортируя друг друга напрямую (кроме `core/*` и `kit/*`).
- Шрифты Montserrat (500/700/800 + italic) и Albert Sans (600/700) — self-host через `@fontsource`.
- Весь текст — `src/content/content.json`.
- Тесты: vitest для чистой логики (движение, близость, чат-движок).
- Деплой: GitHub Actions → Pages, `base` из env. Публикует Жека сам.

## Options Considered

### Option A: Vanilla + three.js (выбрано)
| Dimension | Assessment |
|---|---|
| Complexity | Low |
| Bundle | ~180 KB gz (three + gsap) |
| Параллельная работа | High — файлы-модули с контрактами |

### Option B: React + react-three-fiber + drei
| Dimension | Assessment |
|---|---|
| Complexity | Med |
| Bundle | ~280 KB gz |

**Pros:** декларативность, drei-хелперы (Outlines). **Cons:** лишний слой для 1 экрана; агенты чаще конфликтуют в общем дереве компонентов.

## Consequences

- Все команды запускать с `PATH="$HOME/.local/node/bin:$PATH"`.
- Нет роутинга: deep-link на продукт — через `#/product/<id>` (дешёвый бонус для питча).
