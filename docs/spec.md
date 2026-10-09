# Rendi Hall — спецификация концепта

**Дата:** 2026-10-09 · **Статус:** на ревью у Жеки
**Решения:** [ADR-001 стиль](adr/ADR-001-visual-style.md) · [ADR-002 экран продукта](adr/ADR-002-product-view.md) · [ADR-003 стек](adr/ADR-003-stack-delivery.md)

## 1. Цель

Портфолио-концепт для заказчика Rendi (apprendi.io): интерактивный
изометрический презентационный зал продуктов компании. Публикуется на GitHub
(Pages) как референс, чтобы получить заказ. **Без бэкенда, без LLM** — всё
заскриптовано.

**Успех:**
- открывается < 3 с на нормальном канале, 60 fps на M1-ноутбуке;
- с первого кадра читается «это Rendi» (цвета, шрифты, маскот, контур, тени);
- все 6 продуктов + waitlist проходятся за 2–3 минуты;
- есть путь «без ходьбы» для нетерпеливого зрителя.

## 2. Бренд-токены (источник — CSS apprendi.io)

| Токен | Значение | Роль |
|---|---|---|
| `--lavender` | `#E7DEED` | фон, пол зала |
| `--yellow` | `#F5D360` | облака, primary CTA, ковры |
| `--purple` | `#B77FF5` | Randy, акцентный текст |
| `--purple-link` | `#A04AFF` | ссылки, focus ring |
| `--red` | `#D63532` | акцент Care, редкие детали |
| `--black` | `#000` | контур, текст |
| `--white` | `#FFF` | глаза, карточки |
| `--shadow` | ≈`#CFC6D8` | жёсткая тень (сэмплить с референса маскота) |

Производные оттенки для 3D (стены, дерево пола) — только смешением этих цветов
с белым/чёрным, без новых тонов.

**Типографика:**
- Display: Montserrat 800 *italic*, tracking −1% (заголовки продуктов, лоадер).
- Action: Montserrat 700 *italic* (кнопки, чипы, ссылки-CTA).
- Body: Albert Sans 600 (сообщения чата, описания), line-height 1.5.
- Размеры — из шкалы Жеки: 12 14 16 20 24 32 48 72.

**Формы:** карточки radius 20, контролы 12, пилюли 999 · обводка 1px `--black` ·
primary-кнопка: заливка `--yellow` + чёрная обводка. Все отступы/размеры UI —
только из шкалы ритма (2…16 шаг 2, 20…48 шаг 4, 56…112 шаг 8, 128…240 шаг 16).
> ⚠ Открытый вопрос: у Жеки правило «радиусы ≤16», у бренда 20. По умолчанию берём брендовые 20.

## 3. Контент (плейсхолдеры, English — как сайт)

Компания **Rendi** — продуктовая студия «приложений, которые объясняют себя
сами». Манифест: *Most apps make you guess. We make it click.*

| id | Продукт | Суть | Диорама | Акцент | Хост (NPC у стенда) |
|---|---|---|---|---|---|
| `learn` | Rendi Learn | языки через контекст | стопка книг → дерево со словами-листьями | purple | клякса purple |
| `pay` | Rendi Pay | финансы простым языком | монета-копилка | yellow | клякса yellow |
| `flow` | Rendi Flow | SDK онбординга | гигантский курсор кликает кнопку | black/white | клякса white |
| `care` | Rendi Care | привычки без чувства вины | горшок, растение растёт при подходе | red | клякса red |
| `home` | Rendi Home | умный дом, одна кнопка на сценарий | мини-домик, окна загораются | lavender | клякса lavender |
| `studio` | Rendi Studio | задачи, которые объясняют «зачем» | мольберт со стикерами | yellow | клякса yellow |
| `waitlist` | Waitlist | CTA | стойка с колокольчиком и табличкой | yellow | — |

Все тексты в `src/content/content.json`. Схема чата:

```json
{
  "products": [{
    "id": "pay", "name": "Rendi Pay", "tagline": "Money, in plain words.",
    "accent": "yellow",
    "host": { "name": "Penny", "color": "yellow" },
    "chat": {
      "start": "intro",
      "nodes": {
        "intro": {
          "msgs": [{ "from": "host", "text": "Hey Randy! ..." }],
          "replies": [
            { "label": "What is it?", "to": "what" },
            { "label": "Show me how", "to": "how" },
            { "label": "Join waitlist →", "action": "waitlist" }
          ]
        }
      }
    }
  }],
  "npcs": [{ "id": "v1", "color": "yellow", "line": "..." }],
  "waitlist": { "title": "...", "body": "...", "cta": "...", "thanks": "..." },
  "ui": { "loading": "Making it click…", "hintKeys": "...", "skip": "Skip the walk" }
}
```
`from`: `host` | `randy`. Ответ-кнопка добавляет реплику `randy` с текстом
`label`, затем сообщения узла `to`. `action: "waitlist"` закрывает продукт и
открывает waitlist.

## 4. Мир

**Система координат:** Y вверх, пол y=0, 1 unit ≈ 1 плитка. Зал
`x ∈ [-12, 12]`, `z ∈ [-9, 9]`. Видимые стены — у `x=-12` и `z=-9` (камера
смотрит с +X+Z). Передние стены срезаны.

**Камера:** `OrthographicCamera`, истинная изометрия — смещение от цели
`(k, k, k)`, высота кадра ≈ 14 units, мягкий follow за Randy (lerp 0.08),
кламп по границам зала.

**Раскладка** — единственный источник правды `src/core/layout.js`:

| id | x, z | | id | x, z |
|---|---|---|---|---|
| `learn` | −8, −5 | | `home` | −9, 2.5 |
| `pay` | −3, −6.5 | | `studio` | 9, 2.5 |
| `flow` | 3, −6.5 | | `waitlist` | 0, −1 (центральный остров) |
| `care` | 8, −5 | | spawn Randy | 0, 6 |

Декор (агент ①): деревянный паркет-узор (инстансы), ковры-облака формы с
сайта под стендами, растения в кадках, лавки, гирлянда флажков, окна с
мягким светом, табличка «RENDI» на стене.

**Свет и стиль** (`kit/toon.js`):
- `toonMaterial(color)` — `MeshToonMaterial` с 2-ступенчатым gradientMap (свет/тень, разница ≈12% яркости).
- `withOutline(mesh, thickness=0.035)` — inverted hull, `--black`, backface.
- Тени: один `DirectionalLight` сверху-справа, shadow map 2048, PCF малый радиус (почти жёсткая), пол на `ShadowMaterial` цвета `--shadow`.
- `toonMesh(geom, color, opts)` = материал + контур + castShadow.

## 5. Персонажи

**Randy** (`actors/randy.js`): тело — `ExtrudeGeometry` 8-лепестковой формы
(лепестки неравные, как в SVG), bevel скруглённый, `--purple`; два белых
глаза-диска с чёрными зрачками (зрачки смотрят по направлению движения);
улыбка — чёрная кривая; руки/ноги — `TubeGeometry` по CatmullRom, `--black`,
кисти «варежкой» с 3 пальцами. Высота ≈ 1.4 units. Тело всегда billboard-ish
повёрнуто к камере (как маскот), разворачивается влево/вправо по направлению
(flip по X). Анимации: idle — дыхание scale 1±0.02 + покачивание рук;
walk — шаг ногами, мах руками, bob по Y 0.06; приветствие (машет рукой) при
открытии стенда.

**NPC** (`actors/npc.js`): та же порода, цвета yellow/red/white/lavender, чуть
другие формы лепестков. 4 посетителя бродят по waypoint-ам между стендами,
останавливаются «посмотреть» 2–4 с. 6 хостов стоят у своих стендов.
Подход к посетителю → облачко с репликой 3 с.

## 6. Взаимодействие

**Управление:** стрелки/WASD — движение; клик/тап по полу — идти в точку
(прямая + скольжение вдоль препятствий, без pathfinding); клик по стенду —
идти к нему и открыть; Enter/Space/E — открыть ближайший; Esc — закрыть.

**Близость:** радиус стенда 2.2, NPC 1.6. На входе — кольцо на полу у стенда
(scale-in 200ms) + DOM-чип над стендом `Rendi Pay · Enter`. Чип кликабелен.

**Открытие продукта** (GSAP-таймлайн, ≈900 ms, `power3.inOut`):
1. ввод блокируется, Randy машет;
2. камера наезжает в `focusPose` стенда — диорама в левой половине кадра;
3. одновременно с 40% таймлайна DOM-панель справа раскрывается `clip-path: circle()` из экранной точки стенда;
4. в панели: заголовок (Display 48), tagline, чат стартует с `start`.

Закрытие: Esc / ✕ / клик по 3D-области — обратный таймлайн, ≈ 600 ms
(выход быстрее входа).

**Waitlist:** та же механика; в панели форма email (визуальная, без отправки)
→ состояние «Thanks! We'll make it click for you.»

**Обход без ходьбы:** кнопка «Skip the walk» (bottom-right) → список
продуктов; выбор = мгновенный телепорт Randy к стенду + открытие.
Deep-link `#/product/<id>` открывает продукт при загрузке.

**HUD:** top-left словесный знак «Rendi» (Display); bottom-left легенда
управления (скрывается после первого движения); лоадер — прыгающий Randy +
«Making it click…».

**Мобильный (<768px):** тап по полу/стенду; панель продукта — bottom sheet
60% высоты, диорама в верхней части кадра.

## 7. Архитектура кода

```
rendi-hall/
  index.html
  src/
    main.js            — сборка сцены, порядок update, связывание модулей
    core/  events.js  loop.js  layout.js  tokens.js  motion.js (reduced-motion live-флаг)
    kit/   toon.js
    world/ hall.js
    actors/ randy.js  npc.js
    stands/ learn.js pay.js flow.js care.js home.js studio.js waitlist.js  index.js
    systems/ input.js movement.js proximity.js cameraRig.js
    ui/    tokens.css hud.css prompt.js productView.js chat.js bubble.js hud.js skipList.js
    content/ content.json
  tests/  movement.test.js proximity.test.js chat.test.js
```

### Контракты (не менять без оркестратора)

```js
// core/events.js
export const bus = { on(type, fn), off(type, fn), emit(type, payload) };
// события:
// 'proximity:enter' {kind:'stand'|'npc', id}   'proximity:leave' {kind, id}
// 'stand:open' {id}  'stand:opened' {id}  'stand:close' {id}  'stand:closed' {id}
// 'npc:talk' {id}    'ui:lock' {locked:boolean}  'player:firstMove' {}

// stands/<id>.js — default export
{
  id: 'pay',
  build(kit) /* → THREE.Group, origin = центр стенда на полу, лицом к +X+Z */,
  update(t, dt, state /* 'idle'|'near'|'focused' */) {},
  focusPose: { offset: [x, y, z] /* цель камеры отн. центра */, zoom: 2.4 },
  collider: { r: 1.3 }
}

// actors
createRandy(kit) → { object3d, setVelocity(vx, vz), wave(), update(dt) }
createNpc(kit, { id, color, mode: 'host'|'visitor', anchor|waypoints }) → { object3d, update(dt), position }

// systems (чистые функции — под vitest)
movement.step(pos, vel, dt, colliders, bounds) → newPos
proximity.nearest(pos, targets /* [{id,kind,x,z,r}] */) → {id,kind} | null
cameraRig: { follow(object3d), focus(pose, standWorldPos) → Promise, release() → Promise, toScreen(vec3) → {x,y} }
input: { getMoveVector() → {x,z}, getMoveTarget() → {x,z}|null, clearTarget() }

// ui
chat.createChat(script, el, { onAction }) → { start(), destroy() }
productView.open(id, originScreen) → Promise ; productView.close() → Promise
```

## 8. Нефункциональные требования

**Perf:** DPR cap 2; ≤ 400 draw calls (контуры считаются); геометрия создаётся
один раз; повторяющийся декор — `InstancedMesh`; статичные части одного цвета
внутри персонажа/стенда мержатся (`BufferGeometryUtils.mergeGeometries`) —
цель ≤ 8 draw calls на персонажа, ≤ 20 на стенд; dispose при закрытии не
нужен (сцена живёт всю сессию). Бандл ≤ 300 KB gz без шрифтов.

**Motion:** все таймлайны — GSAP; токены длительности в `core/motion.js`
(fast 200, base 300, focus 900, close 600); `prefers-reduced-motion` читается
живо (`matchMedia` + `change`) → наезд камеры заменяется кроссфейдом 200 ms,
ходьба остаётся.

**A11y:** панель — `role="dialog"` `aria-modal`, фокус-трап, Esc, возврат
фокуса; лог чата `aria-live="polite"`; быстрые ответы — `<button>` ≥ 44 px;
focus ring 2px `--purple-link`; контраст текста ≥ 4.5:1 (`--purple` только на
крупном тексте/акцентах, не на body); canvas с `aria-label`; «Skip the walk»
— первый элемент в tab-порядке.

## 9. Тестирование и приёмка

- vitest: `movement` (скольжение, границы), `proximity` (ближайший, гистерезис), `chat` (переходы узлов, action).
- Визуальная приёмка оркестратором после каждой волны в браузерной панели: скриншоты desktop 1440×900 и mobile 375×812, консоль без ошибок.
- Финал: Lighthouse perf ≥ 80 desktop, ручной проход всех 7 стендов клавиатурой и мышью.

## 10. Вне скоупа

Бэкенд, реальная отправка формы, LLM-чат, звук, мультиязычность,
сохранение прогресса, настоящий pathfinding.
