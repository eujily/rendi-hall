# Rendi Hall Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Эффектный рабочий прототип изометрического зала продуктов Rendi на three.js — для питча, не продакшен.

**Architecture:** Vite + vanilla ES-модули. Оркестратор (Opus) пишет каркас и контракты (Task 0) и интегрирует; 6 Sonnet-агентов параллельно заменяют заглушки своими модулями (Tasks 1–6), не трогая чужие файлы. Связь — через `core/*` и `main.js`.

**Tech Stack:** three.js, GSAP 3, Vite, vitest, @fontsource (Montserrat, Albert Sans).

**Spec:** `docs/spec.md`, `docs/system-design.md`, ADR в `docs/adr/`.

## Prototype scope (решение Жеки 09.10: «тестовое, красиво и эффектно, не готовое решение»)

**Делаем:** зал + декор, Randy, 3 NPC-посетителя, 6 стендов + waitlist, ходьба клавишами и кликом, кольцо + чип близости, наезд камеры + clip-path панель + чат, форма waitlist (визуальная), лоадер, HUD, «Skip the walk», deep-link.
**Откладываем (из spec/system-design):** DOM-fallback без WebGL, адаптивное качество, `?debug`-панель, webglcontextlost, хосты-NPC у стендов (хост живёт аватаром в чате), мобильный bottom sheet (только базовая адаптивность), content.test.

## Global Constraints

- Все команды — с `PATH="$HOME/.local/node/bin:$PATH"` (Node 24 вне PATH).
- Цвета — только из `src/core/tokens.js` (`COLORS`, `mix()`); в CSS — только `var(--…)` из `src/ui/tokens.css`. Никаких новых hex.
- Display — Montserrat 800 italic, tracking −0.01em; Action — Montserrat 700 italic; Body — Albert Sans 600, line-height 1.5.
- Отступы/размеры UI — только из шкалы: 2 4 6 8 10 12 14 16 20 24 28 32 36 40 44 48 56 64 72 80 88 96 104 112 128 144 160…; радиусы: карточка 20, контрол 12, пилюля 999.
- 3D-меши стиля — только через `kit/toon.js` (`toonMesh`, `toonMaterial`, `flatMaterial`). Контур обязателен на всём, кроме пола/стен/мелких плоских деталей.
- Геометрия создаётся один раз, никогда в `update()`. Статичные части одного цвета мержить (`mergeGeometries`). ≤ 8 draw calls на персонажа, ≤ 20 на стенд.
- Агент правит **только свои файлы** из своего Task. Нужно изменить чужой контракт — написать об этом в отчёте, не править.
- Агенты **не коммитят** (параллельная работа в одном репо) — коммитит оркестратор после приёмки.
- Проверка агента перед отчётом: `npm run build` без ошибок, `npm test` зелёный.

## Review Focus

1. Зажатые стрелка + клик по полу одновременно — клавиши побеждают, цель клика сбрасывается (Task 5: тест `keys override click target`).
2. Клик по стенду издалека — Randy идёт и открывает стенд по прибытии, а не мгновенно (Task 0 main.js: pendingStand).
3. Esc во время наезда — откат с текущей точки, без рывка (Task 0 appState: тест `close during OPENING → CLOSING`).
4. Randy не проходит сквозь стенды и не выходит за зал при любом векторе (Task 5: тесты `slides along circle`, `clamped to bounds`).
5. Ресайз окна в FOCUSED — диорама остаётся в левой половине, панель справа (Task 5 cameraRig.resize пересчитывает фокус).

---

### Task 0 (оркестратор): каркас и контракты

**Files:** `package.json`, `vite.config.js`, `index.html`, `.claude/launch.json`, `src/main.js`, `src/core/{tokens,events,appState,layout,motion}.js`, `src/kit/toon.js`, `src/stands/index.js`, заглушки всех файлов Tasks 1–6, `tests/appState.test.js`.

- [ ] npm install three gsap @fontsource/montserrat @fontsource/albert-sans; dev: vite vitest
- [ ] core-модули и toon-kit (интерфейсы ниже)
- [ ] заглушки с рабочими контрактами → сцена запускается целиком
- [ ] `tests/appState.test.js`: переходы EXPLORE→OPENING→FOCUSED→CLOSING→EXPLORE; `close during OPENING → CLOSING`; недопустимый переход → `false`
- [ ] визуальная проверка в браузере, коммит

**Produces (контракты для всех):**

```js
// core/tokens.js
COLORS: { lavender, yellow, purple, purpleLink, red, black, white, shadow,
          floorA, floorB, wall, wallTrim, wood }   // числа 0xRRGGBB
mix(a, b, t) → number

// core/events.js
bus.on(type, fn) → off(); bus.off(type, fn); bus.emit(type, payload)
// события: 'mode' {from,to,event,payload} · 'proximity:enter' {kind,id} ·
// 'proximity:leave' {kind,id} · 'player:firstMove' {}

// core/appState.js
appState.mode            // 'LOADING'|'EXPLORE'|'OPENING'|'FOCUSED'|'CLOSING'
appState.focusedId       // string|null
appState.is(...modes) → bool
appState.request(event, payload) → bool   // events: 'ready','stand:open','stand:opened','stand:close','stand:closed'

// core/layout.js
ROOM = { minX:-12, maxX:12, minZ:-9, maxZ:9 }
STANDS = [{ id, x, z }]                 // learn pay flow care home studio waitlist
STAND_COLLIDER_R = 1.3; STAND_NEAR_R = 2.2; NPC_NEAR_R = 1.6
SPAWN = { x:0, z:6 }; PLAYER_SPEED = 4.2
VISITORS = [{ id, color, waypoints:[{x,z}] }]   // 3 шт.

// core/motion.js
DUR = { fast:0.2, base:0.3, focus:0.9, close:0.6 }; reducedMotion() → bool (live)

// kit/toon.js
toonMaterial(color) → MeshToonMaterial (кеш по цвету)
flatMaterial(color) → MeshBasicMaterial (глаза, зрачки, светящиеся окна)
toonMesh(geometry, color, { outline = 0.03, cast = true, receive = false }) → Mesh (контур — дочерний меш)
addOutline(mesh, thickness) → mesh
setupLights(scene) → { sun }            // единая точка тюнинга света/теней

// stands/<id>.js — default export (строить «лицом» к локальному +Z; index повернёт к камере)
{ id, build() → THREE.Group, update(t, dt, state /*'idle'|'near'|'focused'*/), focusPose: { height, zoom } }
```

---

### Task 1 (агент ①): зал и декор — `src/world/hall.js`

**Interfaces:** Consumes `kit/toon.js`, `COLORS`, `ROOM`, `STANDS`. Produces `createHall() → { object3d, colliders: [{x, z, r}] }` (круговые коллайдеры декора; стены — через `ROOM`, не коллайдеры).

- [ ] Пол: паркет-ёлочка или доски в две тона (`floorA/floorB`) через `InstancedMesh`, receiveShadow; лёгкий бортик-плинтус.
- [ ] Две стены (у `x=minX` и `z=minZ`), высота ≈ 4, цвет `wall`, верхний кант `wallTrim`; на стенах: 3–4 окна с рамами и `flatMaterial` светлым стеклом, табличка «RENDI» (Montserrat-подобная ExtrudeGeometry не нужна — плашка `yellow` + текст через CanvasTexture шрифтом Montserrat 800 italic).
- [ ] Ковры-облака (силуэт облака с сайта: волнистый край) `yellow` под каждым стендом, плоские, без контура, чуть выше пола.
- [ ] Уют Stardew: 6–8 растений в кадках, 2 лавки, гирлянда флажков вдоль стен (цвета бренда), торшер/лампы; всё с контуром.
- [ ] Декор не перекрывает проходы: не ближе 2.6 к центру любого стенда и к `SPAWN`.
- [ ] Отчёт: draw calls сцены зала (`renderer.info.render.calls` при одном зале).

### Task 2 (агент ②): персонажи — `src/actors/blob.js`, `randy.js`, `npc.js`

**Interfaces:** Consumes `kit/toon.js`, `COLORS`, `VISITORS`, `NPC_NEAR_R`. Produces:
`createBlob({ color, seed, scale }) → { object3d, rig }` (общая порода),
`createRandy() → { object3d, setVelocity(vx, vz), wave(), update(dt) }`,
`createNpc({ id, color, waypoints }) → { id, object3d, update(dt), position /*Vector3*/ }`.

- [ ] Тело: ExtrudeGeometry 8-лепестковой формы с неравными лепестками (силуэт маскота с референса — `docs/ref/randy.png` если есть, иначе по описанию в spec §5), скруглённый bevel, `purple`; плоское тело стоит вертикально лицом к камере (как картинка), высота Randy ≈ 1.4.
- [ ] Глаза: белые диски (`flatMaterial(white)`) с контуром + чёрные зрачки, зрачки смещаются в сторону движения; улыбка — тонкая чёрная трубка-дуга.
- [ ] Руки/ноги: `TubeGeometry` по CatmullRom, `black`, кисти-«варежки» с 3 пальцами (как на референсе), ступни-«лодочки».
- [ ] Анимация (только трансформы/перестройка кривых без new Geometry в кадре — ноги/руки как шарнирные Group с вращением): idle — дыхание scale 1±0.02, покачивание рук; walk — шаг, мах, bob 0.06; разворот по направлению (scale.x = ±1 с плавностью); `wave()` — машет правой рукой ~1.2 с.
- [ ] Тень-клякса под персонажем: плоский эллипс `shadow` (персонажи плоские, тень-карта от них тонкая — нужна декаль).
- [ ] NPC: та же порода, цвета yellow/red/white, другие `seed`; ходят по waypoints со скоростью 1.6, пауза 2–4 с на точке, лицом к ближайшему стенду на паузе.
- [ ] ≤ 8 draw calls на персонажа (мерж статичных частей одного цвета).

### Task 3 (агент ③): стенды Learn, Pay, Flow — `src/stands/learn.js`, `pay.js`, `flow.js`

### Task 4 (агент ④): стенды Care, Home, Studio, Waitlist — `src/stands/care.js`, `home.js`, `studio.js`, `waitlist.js`

**Interfaces (оба):** Consumes `kit/toon.js`, `COLORS`, `mix`. Produces default export по контракту стенда (Task 0).

Общее для каждого стенда:
- [ ] Пьедестал: скруглённый цилиндр/октагон r≈1.1, h≈0.5, `white` с кантом акцента; табличка с названием продукта спереди (CanvasTexture, Montserrat 800 italic). Габарит диорамы ≤ 2.2 по высоте, внутри r 1.2.
- [ ] `update(t, dt, state)`: `idle` — тихая петля (покачивание/вращение); `near` — оживление (то, что в таблице spec §3: растение растёт, окна загораются, курсор кликает…), с easing, без рывков; `focused` — максимум жизни + медленный поворот диорамы ±15°.
- [ ] `focusPose`: `height` — высота центра диорамы, `zoom` — во сколько раз приблизить (подобрать так, чтобы диорама занимала ~70% высоты левой половины экрана; стартовая точка 2.6).
- [ ] ≤ 20 draw calls на стенд.

Диорамы (spec §3): learn — стопка книг → дерево со «словами»-листьями (плашки с буквами); pay — монета-копилка (монета на ребре с прорезью, монетки падают в `near`); flow — гигантский курсор кликает по пилюле-кнопке (`yellow` с чёрным контуром, как CTA сайта), кнопка проминается; care — горшок, растение растёт и раскрывает цветок `red`; home — мини-домик, окна загораются `yellow` по очереди; studio — мольберт со стикерами, стикеры «приклеиваются» по одному; waitlist — стойка-ресепшен с колокольчиком и табличкой «Join the waitlist», колокольчик подпрыгивает.

### Task 5 (агент ⑤): системы — `src/systems/input.js`, `movement.js`, `proximity.js`, `cameraRig.js`, `tests/movement.test.js`, `tests/proximity.test.js`

**Interfaces:** Consumes `bus`, `appState`, `ROOM`, layout-константы, `DUR`, `reducedMotion`, gsap. Produces:

```js
// movement.js (чистые)
step(pos /*{x,z}*/, vel /*{x,z}*/, dt, colliders /*[{x,z,r}]*/, bounds /*ROOM*/, radius = 0.45) → {x, z}
velocityToward(pos, target, speed, arriveDist = 0.15) → {x, z}   // {0,0} при прибытии

// proximity.js
nearest(pos, targets /*[{id,kind,x,z,r}]*/) → {id, kind} | null     // чистая
createProximity(targets, hysteresis = 0.3) → { update(pos), current /*{id,kind}|null*/ }  // эмитит proximity:enter/leave

// input.js
createInput(dom, { pickFloor(ndc) → {x,z}|null, pickStand(ndc) → id|null })
  → { getMoveVector() → {x,z} /*экранные стрелки → мировые оси изометрии*/, getMoveTarget() → {x,z}|null, clearTarget(),
      onInteract(fn), onBack(fn), onStandClick(fn /*id*/) }

// cameraRig.js
createCameraRig() → { camera, follow(object3d), update(dt), focus(worldPos /*Vector3*/, pose) → Promise,
                      release() → Promise, toScreen(vec3) → {x, y} /*CSS px*/, resize(w, h) }
```

- [ ] TDD movement: `moves by vel*dt`, `slides along circle` (вектор в коллайдер → касательная составляющая сохраняется), `clamped to bounds` (с учётом radius), `velocityToward arrives`.
- [ ] TDD proximity: `nearest within r`, `null outside`, `hysteresis: leave only beyond r+0.3`.
- [ ] input: стрелки/WASD (стрелка «вверх» = вглубь экрана, т.е. мировой −X−Z, нормализованный); клик/тап по полу → цель; клик по стенду → `onStandClick`; Enter/Space/E → `onInteract`; Esc → `onBack`; тест `keys override click target` (есть клавиши → `getMoveTarget()` null и цель сброшена); `player:firstMove` при первом движении. Игнор ввода движения, когда `!appState.is('EXPLORE')`.
- [ ] cameraRig: Ortho, истинная изометрия (смещение (k,k,k), lookAt цель), высота кадра 14 units, follow-lerp 0.08 с клампом к `ROOM`; `focus` — GSAP-таймлайн `DUR.focus` `power3.inOut`: цель → `worldPos + (0, height, 0)` со сдвигом по экранному «вправо» так, чтобы диорама встала в центр **левой** половины (на ширине < 768 — в центр **верхней** половины), zoom → `pose.zoom`; `release` — обратно к Randy за `DUR.close`; при `reducedMotion()` — мгновенно. Ресайз в фокусе пересчитывает сдвиг.

### Task 6 (агент ⑥): UI и контент — `src/ui/*`, `src/content/content.json`, `tests/chat.test.js`

**Interfaces:** Consumes `bus`, `appState`, `DUR`, `reducedMotion`, gsap, content. Produces:

```js
createHud({ onSkip }) → { hideLoader(), el }          // лого top-left, легенда bottom-left (прячется на player:firstMove), «Skip the walk» bottom-right
createPrompt() → { show(label), hide(), setPosition(x, y) }   // чип над стендом
createBubbles() → { say(id, text, ms = 3000), setPosition(id, x, y), isShowing(id) }
createSkipList(products /*[{id,name,tagline}]*/, onPick /*id*/) → { open(), close() }
createProductView({ content, onRequestClose }) → { open(id, origin /*{x,y}*/) → Promise, close() → Promise }
createChat(script, el, { host, accent, onAction }) → { start(), destroy() }   // чистая логика узлов + DOM
```

- [ ] `ui/tokens.css`: CSS-переменные бренда (spec §2), @fontsource-импорты (Montserrat 500/700/800 + italic, Albert Sans 600/700), focus ring 2px `--purple-link`.
- [ ] Лоадер на весь экран `--lavender`: прыгающий Randy (SVG-силуэт кляксы `--purple` с контуром) + «Making it click…» (Display).
- [ ] Чип близости: пилюля `--white`, обводка 1px `--black`, `Rendi Pay` (Action) + кап-клавиша `Enter`; появление scale 0.9→1 + fade, `DUR.fast`; кликабелен (→ тот же путь, что Enter — через колбэк `onClick` в `show(label, onClick)`).
- [ ] Панель продукта (справа, 50% ширины; < 768 — нижние 60%): фон `--lavender`, карточка radius 20, обводка 1px. Раскрытие: `clip-path: circle(0 at origin)` → `circle(150% at origin)` за 0.6 с `power3.out`; закрытие быстрее (0.36 с). Шапка: название (Display 48), tagline (Body 20), ✕ (44×44, aria-label). `role="dialog"`, `aria-modal`, фокус-трап, Esc.
- [ ] Чат: сообщения хоста слева (аватар — мини-клякса цвета хоста), Randy справа (`--purple`, белый текст ≥ 20px жирный — контраст), появление по одному с индикатором «печатает…» 400–700 мс; быстрые ответы — пилюли-кнопки (≥ 44 px), primary `→ waitlist` — `--yellow`. Лог `aria-live="polite"`.
- [ ] Waitlist (`id === 'waitlist'`): вместо чата — заголовок, текст, поле email с видимым label, primary-кнопка; сабмит → состояние «Thanks! We'll make it click for you.» без сети.
- [ ] `content.json` по схеме spec §3: 6 продуктов × граф 5–7 узлов (`intro`, `what`, `how`, `who`, `why-rendi`…), живой короткий английский копирайт в тоне «we make it click» (без воды, каждая реплика ≤ 2 предложений), имена хостов, реплики 3 NPC, тексты waitlist/ui. В каждом графе есть путь к `action: "waitlist"`.
- [ ] TDD chat (логика отдельно от DOM, `src/ui/chatEngine.js`): `start shows start node`, `reply appends randy line then target node`, `action reply calls onAction`, `every product graph reaches waitlist` (по content.json).

---

### Task 7 (оркестратор): интеграция и приёмка

- [ ] Подключить реальные модули в `main.js`, прогнать сцену, скриншоты 1440×900 и 375×812, консоль чистая.
- [ ] Тюнинг света/контуров/камеры до «эффектно», возврат агентам с конкретикой при необходимости.
- [ ] `npm run build`, README (как запустить, управление, деплой на Pages), GitHub Actions workflow, коммит.
