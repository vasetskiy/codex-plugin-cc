# План разработки команды Plan Review

## Цель

Добавить first-class команду `/codex:plan-review <path/to/plan.md>` для
read-only, repo-grounded ревью планов.

Пользователь передает Codex файл плана. Codex читает план, эффективно добирает
релевантный контекст из репозитория, использует агентов там, где это повышает
покрытие без раздувания основного контекста, и возвращает структурированный
результат: findings с severity, evidence и вариантами исправления.

## Продуктовое решение

Делать отдельную команду, а не перегружать `/codex:review`.

Сейчас `/codex:review` означает code review локального git-состояния через
native Codex review targets. Если добавить туда positional path, UX станет
двусмысленным: аргумент после команды может быть путем к файлу, focus text или
будущим diff target.

Предпочтительный интерфейс и future extensions:

```text
/codex:plan-review --wait projects/active/foo/plan/wave-1/plan.md
/codex:plan-review projects/active/foo/plan/wave-1/plan.md
/codex:plan-review --background projects/active/foo/plan/wave-1/plan.md
/codex:plan-review --format markdown projects/active/foo/plan.md
```

Без `--wait` / `--background` UX должен совпадать с текущими
`/codex:review` и `/codex:adversarial-review`: slash-command wrapper один раз
спрашивает пользователя, ждать ли результат или запустить run в фоне. Companion
сам не открывает интерактивный вопрос; прямой запуск
`codex-companion.mjs plan-review path/to/plan.md` выполняется как обычный
foreground tracked job.

Default framing: нейтральный readiness review. Команда отвечает на вопрос
`можно ли реализовывать этот план как написан`, а не пытается максимально
агрессивно спорить с любым решением.

Adversarial framing полезен, но не должен быть default UX для MVP. Его лучше
добавить позже как явный режим:

```text
/codex:plan-review --mode adversarial path/to/plan.md
/codex:plan-review --focus "migration safety" path/to/plan.md
```

Так команда остается предсказуемой: `/codex:review` ревьюит git state,
`/codex:adversarial-review` ревьюит implementation approach, а
`/codex:plan-review` ревьюит plan file как отдельный target.

## Контракт результата

Нужна отдельная output schema, независимая от code-review schema.

Верхнеуровневые поля, которые возвращает model output:

- `schema_version`: например `plan-review-output/v1`
- `verdict`: `approve` или `needs-attention`
- `summary`: короткий ship/no-ship вывод
- `findings`: список существенных проблем плана, отсортированный по severity
- `requires_verify`: evidence-bounded вопросы, которые Codex не может честно
  классифицировать как finding без дополнительной проверки
- `coverage`: какие areas Codex реально проверил
- `residual_risks`: что Codex не смог проверить или проверил неполно

Runtime metadata не должна быть частью model output: модель не знает
session/thread id, elapsed time и точный timestamp завершения. Companion
добавляет эти поля в stored job wrapper после `runAppServerTurn`:

- repo root / command cwd
- branch/status summary
- normalized plan path
- mode и command options
- seed packet summary
- schema version
- session/thread id, turn id
- started/completed timestamps и elapsed time

Каждый finding должен включать:

- `severity`: `critical`, `high`, `medium` или `low`
- `readiness_effect`: `blocks-implementation`, `should-fix-before-start`,
  `can-fix-during-implementation`
- `requires_re_review`: boolean
- `title`
- `plan_file`
- `line_start`
- `line_end`
- `evidence`: массив конкретных code/docs/tests/tool outputs, на которые
  опирается вывод
- `risk`: что может пойти не так, если реализовать план как написано
- `recommendation`
- `options`: один или несколько вариантов решения с tradeoff

Findings не должны использоваться для informational notes. Если замечание не
влияет на implementation readiness, оно должно попасть в `residual_risks`,
`coverage.notes` или не попасть в результат вообще.

`severity` и `requires_re_review` не одно и то же. Severity отвечает на вопрос
`насколько серьезна проблема`, а `requires_re_review` отвечает на вопрос
`если это исправить в плане, нужна ли новая проверка измененного плана`.

`requires_re_review: true`, если recommended fix меняет scope, non-goals,
decision, files budget, implementation order/dependencies, public contract,
artifact semantics или ослабляет/заменяет verify gate. `false`, если fix
additive-only: добавляет тест/guard/assertion, уточняет wording без смены
scope, чинит stale ref/path/link, добавляет evidence line refs или усиливает
существующую проверку без смены contract.

Evidence object:

- `type`: `plan`, `code`, `test`, `doc` или `tool-output`
- `path`: repo-relative path, если применимо
- `line_start` / `line_end`: если применимо
- `summary`: короткое описание evidence без длинных цитат

Option object:

- `title`
- `change`
- `tradeoff`

Requires-verify object:

- `question`
- `why_it_matters`
- `suggested_check`: конкретный read-only command, файл или runtime check,
  который подтвердит/снимет вопрос
- `blocks_approval`: boolean; `true`, если ответ на вопрос может invalidate
  readiness verdict и поэтому итоговый `approve` невозможен без проверки
- `related_refs`: repo-relative refs, если применимо

Coverage object:

- `area`: например `code`, `tests`, `docs`, `migration`, `api`, `ui`,
  `workflow`
- `status`: `checked`, `partially-checked` или `not-applicable`
- `evidence`: короткий список repo-relative refs или tool outputs
- `notes`

`approve` разрешен только когда:

- `findings` пустой
- `coverage` явно показывает, что релевантные области проверены
- области, которые не проверялись, помечены как `not-applicable` или вынесены в
  `residual_risks`
- `requires_verify` пустой или содержит только вопросы с
  `blocks_approval: false`

`approve` не должен означать `две GREEN подряд`. Plugin command делает один
review pass. Если repo хочет convergence loop, он строит его поверх
структурированного результата, используя `requires_re_review` и собственный
workflow.

В чате результат нужно рендерить findings-first: компактная таблица, затем
детали. Полный JSON и markdown-render должны сохраняться в stored job result,
чтобы `/codex:result` мог вернуть полный артефакт.

## Метод ревью

Prompt должен делать именно ревью плана, а не общую критику markdown.

Codex должен:

1. Полностью прочитать plan file.
2. Построить внутреннюю claim/scope map:
   - заявленные touchpoints: файлы, модули, API, UI, migrations, workflow
   - assumptions, на которых держится план
   - verify gates, которые план обещает использовать
   - non-goals и deferred scope
   - risk domains: data loss, auth, migration, concurrency, rollback, UX и т.п.
   - context candidates, которые нужно проверить read-only перед verdict
3. Выделить заявленный scope: файлы, модули, тесты, миграции, API, UI и workflow
   surfaces, которые план обещает затронуть.
4. Построить компактную карту репозитория вокруг этого scope.
5. Использовать read-only tools и агентов для точечной проверки релевантного
   контекста.
6. Сравнить план с текущим кодом, тестами и документацией.
7. Репортить только material findings, подкрепленные конкретным evidence.
8. Не превращать bounded uncertainty в finding: если evidence недостаточно,
   вынести вопрос в `requires_verify` с конкретной проверкой.
9. Не читать historical `review*.md` / audit / retrospective artifacts по
   умолчанию. Их можно читать только если план явно ссылается на конкретный
   review/audit claim или если это нужно для проверки imported/deferred scope.

Полезное разбиение на агентов:

- Code-seam agent: проверяет, совпадает ли план с текущими implementation seams
  и invariants.
- Test/verification agent: проверяет, достаточны ли предложенные тесты и можно ли
  их реально выполнить, не запуская сами tests/builds в рамках plan review.
- Docs/state agent: проверяет current-state docs, active project constraints и
  stale assumptions, если в репозитории есть plans/waves/project docs.

Main Codex run сохраняет финальную ответственность. Агенты возвращают только
bounded evidence packets: checked refs, observed mismatch, uncertainty and
suggested read-only checks. Они не ставят финальный verdict и не решают
readiness. Финальный ответ дедуплицирует findings, ранжирует severity и
отбрасывает неподтвержденные claims.

Агенты должны быть read-heavy и bounded. Main prompt не должен требовать всегда
запускать всех агентов: он должен разрешать их, когда план затрагивает достаточно
разные области или когда subagent реально уменьшает context pollution. Для
маленького плана один main run без агентов допустим.

Read-only означает не только sandbox, но и runtime policy: reviewer не запускает
tests/builds/migrations/docker как часть ordinary plan review. Он может
предложить конкретные verification commands в `requires_verify` или
`coverage.notes`, но не должен превращать plan review в QA run. Если
`suggested_check` относится к tests/builds/migrations/docker, это рекомендация
для отдельного verification step, а не команда, которую plan-review runtime
запускает сам.

Companion должен enforce это как audit/fail, а не только как prompt-инструкцию:

- после `runAppServerTurn` проверить `commandExecutions`
- после `runAppServerTurn` проверить `fileChanges`; любой completed file-change
  item для plan-review является policy violation, даже если sandbox должен был
  предотвратить write
- если запускалась forbidden command class, job завершается `exitStatus: 1`
- stored result сохраняет `policyViolation`, список нарушивших команд, raw final
  message и parsed output, если parsing успел пройти
- rendered result начинается с policy failure, затем показывает captured output
  как диагностический материал
- implementation detail для текущего tracked-job plumbing: policy violation должен
  возвращать normal execution object с `exitStatus: 1`, `payload` и `rendered`,
  а не бросать исключение после audit. Иначе `runTrackedJob` сохранит только
  generic `errorMessage` и потеряет parsed output / raw final message /
  `policyViolation` diagnostic.

Forbidden-command classifier должен быть консервативным и смотреть на executable
patterns, а не на любые слова `test`/`build` в строке. Он должен ловить реальные
QA/runtime/migration commands (`npm test`, `npm run build`, `pytest`, `jest`,
`vitest`, `cargo test`, `go test`, `mvn test`, `gradle test`, `tsc`, `eslint`,
`ruff`, `docker`, `docker compose`, `prisma migrate`, `alembic`,
`rails db:migrate` и похожие), но не блокировать read-only inspection вроде
`rg "test"` или чтение файлов `tests/*.test.*`.

## Стратегия контекста

Не надо заранее инлайнить широкий repository context.

Initial prompt должен содержать только:

- `schema_version` seed packet, например `plan-review-seed/v1`
- repo root
- текущую branch/status summary
- нормализованный путь к плану
- `plan_sha256`, byte length и line count
- полный текст плана и line-indexed representation, чтобы findings могли
  ссылаться на стабильные `line_start` / `line_end`
- инструкцию добирать дополнительные файлы read-only по необходимости
- инструкцию использовать агентов, когда это улучшает покрытие без засорения
  main context
- инструкцию учитывать repo guidance (`AGENTS.md`, `CLAUDE.md` или ближайший
  semantic equivalent), если она релевантна scope плана, но не инлайнить широкий
  docs corpus заранее

Так стартовый context packet остается маленьким, а Codex тратит контекст на
реальные seams, зависящие от конкретного плана.

Helper `collectPlanReviewSeedContext(cwd, planPath)` должен возвращать
machine-friendly seed packet, а не только prompt string. Он владеет:

- repo root / command cwd / normalized plan path
- dirty branch/status summary, включая untracked signal
- полный plan text, line count, byte length, `plan_sha256` и
  `plan_lines: [{line, text}]`
- nearby guidance candidates with `path`, `role`, `selection_reason` и
  `read_by_default`: root/subtree `AGENTS.md`, `CLAUDE.md`, `README.md` или
  semantic equivalents
- adjacent context candidates near the plan with `path`, `role`,
  `selection_reason` и `read_by_default`: `state.md`, `current-state`,
  `CURRENT_STATE.md`, parent `plan.md`, `decisions.md`, если
  они существуют
- declared implementation touchpoints extracted from path-like plan references,
  with repo-relative path, references back to plan lines, status, and
  `read_by_default`
- bounded `attached_context` entries for the selected default adjacent context
  candidates and existing text touchpoints, with repo-relative path, role,
  source, content digest, included byte/line counts, truncation flag, and
  line-indexed text
- historical artifacts policy: `review*.md`, audits и postmortems не читать по
  умолчанию

Prompt construction, stored metadata, renderer и future output artifact должны
брать эти поля из seed packet, а не пересобирать пути и context hints
независимо.

Guidance/context candidate discovery должен быть bounded и deterministic:

- пройти ancestor chain от plan directory до repo root и искать
  `AGENTS.md`, `CLAUDE.md`, `README.md` и ближайшие obvious equivalents
- добавить root-level guide candidates и sibling/parent плановые файлы вроде
  `state.md`, `current-state`, `decisions.md`
- не делать широкого recursive docs crawl в seed collector
- отметить `read_by_default: true` только для ближайшего scope guide и root guide;
  adjacent context candidates are selected deterministically and bounded before
  hard-attachment; остальные candidates остаются hints, которые Codex читает по
  необходимости
- не требовать, чтобы plan file был git-tracked; untracked план является
  валидным review target, если он проходит repo-boundary и text checks

## Архитектура реализации

1. Добавить `plugins/codex/commands/plan-review.md`.
2. Добавить subcommand `plan-review` в
   `plugins/codex/scripts/codex-companion.mjs`.
3. Добавить `plugins/codex/prompts/plan-review.md`.
4. Добавить `plugins/codex/schemas/plan-review-output.schema.json`.
5. Добавить `plugins/codex/scripts/lib/plan-review.mjs` с helper-ами
   `resolvePlanReviewPath`, `collectPlanReviewSeedContext`,
   `validatePlanReviewResult`, `auditPlanReviewPolicy` и
   `buildPlanReviewPrompt`.
6. Запускать ревью через существующий `runAppServerTurn`:
   - `sandbox: "read-only"`
   - dedicated output schema
   - tracked job metadata kind `plan-review`
7. Добавить dedicated `renderPlanReviewResult`, не переиспользуя
   `renderReviewResult`, потому что code-review schema не знает про
   `coverage`, `residual_risks`, structured `evidence` и `options`.
8. Расширить job kind plumbing:
   - `kind: "plan-review"`
   - `kindLabel: "plan-review"`
   - status/result/cancel должны показывать plan-review как отдельный тип, а не
     схлопывать его в generic `review`
9. Для background режима в MVP зеркалить текущие review commands:
   - slash-command wrapper запускает тот же companion command через Claude
     `Bash(..., run_in_background: true)`
   - companion выполняет `plan-review` как foreground tracked job внутри своего
     процесса
   - `--background` остается command-layer execution flag, а не request на
     companion-side detached worker
   - generic `job-worker` с dispatch по `request.kind` остается future cleanup,
     а не частью MVP
10. В stored job result сохранять:
    - parsed model JSON
    - raw final message
    - rendered markdown
    - seed packet summary
    - plan content digest (`plan_sha256`), line count и normalized plan path,
      чтобы result был привязан к конкретной версии файла
    - companion-owned runtime metadata: thread/session id, turn id, elapsed,
      schema version, command args
    - `policyViolation`, если runtime audit поймал forbidden command class
11. Обновить README и plugin metadata wording, чтобы явно упоминать plan review:
    `README.md`, `package.json`, `plugins/codex/.claude-plugin/plugin.json` и
    `.claude-plugin/marketplace.json`.
12. Добавить тесты на command docs, path validation, prompt construction,
   rendering, background jobs, job kind plumbing и audit/fail для forbidden
   commands.

Structured output validation не должна полагаться только на app-server
`outputSchema`. Companion после `parseStructuredOutput` должен проверить:

- `schema_version === "plan-review-output/v1"`
- top-level arrays and required fields have the expected shape
- `verdict: "approve"` совместим с пустыми findings и
  `requires_verify[].blocks_approval !== true`
- every finding uses the normalized plan path in `plan_file`
- `line_start` / `line_end` are positive, ordered and within seed `line_count`
- `evidence`, `options`, `coverage` and `requires_verify` objects have the
  required minimal fields
- renderer degrades gracefully when JSON parses but fails this validation,
  preserving raw final message and parse/validation diagnostics

### Slash-command contract

`plugins/codex/commands/plan-review.md` должен быть thin deterministic wrapper,
а не вторым reviewer layer:

```yaml
description: Run a Codex readiness review for a plan file
argument-hint: '[--wait|--background] <path/to/plan.md>'
disable-model-invocation: true
allowed-tools: Bash(node:*), AskUserQuestion
```

Wrapper behavior:

- не читает plan/repo на Claude-side
- не использует `Read`, `Grep` или `Glob`
- сохраняет `$ARGUMENTS` как есть
- если raw arguments содержат `--wait`, запускает foreground command без вопроса
- если raw arguments содержат `--background`, запускает Claude background Bash
  без вопроса
- если mode flag не передан, использует `AskUserQuestion` exactly once с
  вариантами `Wait for results` и `Run in background`, рекомендуя background
- foreground command:
  `node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" plan-review "$ARGUMENTS"`
- background command: тот же command через `Bash(..., run_in_background: true)`
- stdout companion возвращается пользователю verbatim, без summarize/rewrite

Companion-side parsing для `plan-review` должен явно объявить `--wait`,
`--background` и `--json` boolean flags, а также hidden test/runtime option
`--cwd`. `--wait` и `--background` не являются plan paths и не должны попадать в
positional path count после `splitRawArgumentString`. Если переданы оба флага,
companion завершает команду ошибкой. В MVP должен остаться ровно один plan path
после удаления command-layer execution flags; неизвестные `--flags` нельзя
молча трактовать как plan path. `--` остается допустимым separator для редкого
случая, когда path начинается с `-`.

Future `--output` slice:

- output file path задается явно пользователем; implicit repo writes в MVP нет
- write должен быть atomic: сначала temp file в output dir, затем rename
- если появится `--output-dir`/`--review-numbering`, нужен allocator с lock и
  placeholder semantics, аналогичный по идее `reviewN.md` allocation, но не
  привязанный к `shift-happens` directory layout
- markdown artifact должен включать runtime metadata footer и ссылку/ID stored
  job result; JSON остается source of truth

## Работа с path

Команда должна:

- требовать ровно один plan path в MVP
- резолвить path относительно command cwd, затем нормализовать к repo root
- запрещать выход за repo root
- отклонять отсутствующие файлы
- отклонять директории
- отклонять вероятно бинарные файлы
- читать файл как UTF-8 text через fatal UTF-8 decode; replacement characters от
  невалидных байтов не должны молча попадать в prompt
- в findings показывать user-facing relative path
- использовать canonical/real path checks, чтобы symlink не обходил repo-root
  boundary
- принимать любой UTF-8 text file в runtime, но документировать Markdown как
  recommended format для line-oriented plan review

Future `--context path` должен использовать те же boundary checks:

- repeated `--context` принимает только files внутри repo root
- context files читаются как UTF-8 text
- context files не превращают command в multi-plan review; они только adjacent
  evidence/context hints
- historical review/audit files разрешены только если явно переданы через
  `--context` или обнаружены как direct reference в plan text

## MVP Scope

Первый slice:

- `/codex:plan-review path/to/plan.md`
- `/codex:plan-review --wait path/to/plan.md`
- `/codex:plan-review --background path/to/plan.md`
- если `--wait` и `--background` не переданы, slash-command wrapper спрашивает
  пользователя так же, как current review commands
- direct companion run поддерживает `--json` для automation/tests, как текущие
  companion commands
- только read-only
- audit/fail для forbidden command classes, чтобы plan review не превращался в
  tests/builds/migrations/docker run
- audit/fail для unexpected file changes в captured app-server events
- structured JSON schema с `schema_version`, `findings[].requires_re_review`,
  `requires_verify[].blocks_approval`, `coverage`, `residual_risks`; runtime
  metadata добавляет companion в stored job wrapper
- seed packet `plan-review-seed/v1`
- seed включает `plan_lines` и machine-readable context candidates
- dedicated markdown findings table
- stored job result через существующий job mechanism
- `/codex:status`, `/codex:result` и `/codex:cancel` видят `kindLabel:
  "plan-review"` через existing tracked-job mechanism
- без явного output file path

Второй slice:

- улучшенный markdown render для полных findings/options
- status/result показывают расширенную runtime metadata: elapsed,
  session/thread id, schema version, seed summary
- optional generic `job-worker` с dispatch по `request.kind`, если понадобится
  companion-side detached execution вместо Claude background Bash

Дальше:

- `--format json|markdown`
- `--output docs/reviews/.../reviewN.md`
- `--output-dir docs/reviews/...` с allocator/lock, если UX покажет, что это
  нужно чаще явного file path
- `--focus "migration safety"`
- `--mode readiness|adversarial`
- optional adjacent-context hints, например `--context path/to/state.md`
- repeated `--context path` для явных соседних docs без multi-plan ambiguity
- optional `--no-agents` для deterministic single-run review, если пользователь
  хочет исключить delegated context exploration

## Acceptance Criteria

- Существующее поведение `/codex:review` не меняется.
- Существующее поведение `/codex:adversarial-review` не меняется.
- `/codex:plan-review path/to/plan.md` читает этот файл как review target, а не
  как focus text; без mode flag slash-command wrapper сначала спрашивает
  foreground/background, затем запускает companion.
- Codex run остается read-only.
- Если Codex запускает forbidden command class, companion помечает job failed и
  сохраняет policy violation audit.
- Если Codex пытается применить file change, companion помечает job failed и
  сохраняет policy violation audit.
- Результат имеет deterministic shape и рендерится как findings-first markdown.
- Companion валидирует parsed JSON против seed path/line bounds и schema version
  до успешного render.
- Findings ссылаются на строки плана и evidence из текущих repo files или tool
  outputs.
- Findings имеют `requires_re_review`, отделенный от severity.
- Findings не содержат informational-only notes; такие замечания уходят в
  `coverage.notes`, `residual_risks` или исключаются.
- Evidence-bounded uncertainty попадает в `requires_verify`, а не в severity
  findings.
- `requires_verify` содержит `blocks_approval`, и `approve` невозможен при любом
  `blocks_approval: true`.
- Если существенных findings нет, результат должен быть `approve`, без filler.
- `approve` содержит meaningful `coverage`, а не пустую формальность.
- Historical `review*.md` не читаются по умолчанию и не становятся hidden source
  of truth.
- `/codex:status`, `/codex:result` и `/codex:cancel` различают `plan-review`
  jobs.
- Existing exact command-list tests обновлены так, чтобы `plan-review.md` был
  ожидаемой командой, а не случайным extra file.
- Тесты покрывают missing path, outside-repo path, попадание line-indexed plan
  content в prompt, seed packet shape, claim/scope map instructions, schema
  parsing, result rendering, `schema_version`, `plan_sha256`,
  `requires_verify`, `requires_verify[].blocks_approval`,
  `findings[].requires_re_review`, finding line bounds, informational-only
  exclusion, historical-review exclusion и job kind/status/result handling.
- Тесты покрывают slash-command wrapper contract: no Claude-side `Read/Grep/Glob`,
  raw `$ARGUMENTS` forwarding, `AskUserQuestion` без mode flag, foreground
  command, background Bash и verbatim stdout.
- Тесты покрывают audit/fail: forbidden command execution приводит к failed job,
  policy violation сохраняется в stored result, unexpected file changes приводят
  к failed job, а read-only inspection commands вроде `rg` не блокируются.
- `tests/fake-codex-fixture.mjs` умеет отдавать отдельный
  `plan-review-output/v1` payload и симулировать forbidden command/file-change
  events, чтобы runtime tests проверяли именно новый контракт, а не старую
  adversarial-review schema.

## Implementation Order

1. Schema + pure helpers: path resolution, fatal UTF-8 read, seed collection,
   result validation and policy classifier/audit with focused unit tests.
2. Prompt + renderer: `plan-review.md`, `buildPlanReviewPrompt`,
   `renderPlanReviewResult`, parse/validation failure rendering and stored
   result behavior.
3. Companion subcommand: `plan-review` parsing, tracked job metadata,
   `runAppServerTurn`, policy audit, `--json`, status/result/cancel visibility.
4. Slash command wrapper and docs: `commands/plan-review.md`, README, package and
   plugin metadata.
5. Runtime tests with fake app-server: success, findings, invalid JSON,
   validation failure, forbidden command, unexpected file change, `--background`
   foreground-tracked behavior and command-list regression.
6. Final validation outside the plan-review runtime: `npm test`; `npm run build`
   if generated app-server types are available in the checkout.

## Заимствованные Практики Из Shift Happens

Берем не repo-specific форму `projects/**` / waves / `reviewN.md` как hard
dependency, а общие практики:

- **Deterministic review target.** Один plan file является target; adjacent docs
  могут быть context, но не превращают run в multi-plan review.
- **Structured packet as SSOT.** Seed packet владеет repo root, plan path,
  branch/status, line-indexed plan text, guidance/context candidates и policy
  flags.
- **Findings-first artifact.** Chat render начинается с существенных findings,
  потом детали, coverage и residual risks.
- **Severity != gate effect.** `requires_re_review` отделен от severity и пригоден
  для внешних convergence workflows.
- **Evidence-bounded verify.** Недоказанные вопросы идут в `requires_verify`, а
  не маскируются под findings.
- **Historical artifacts are history.** `review*.md`, audits и postmortems не
  являются source of truth без явной ссылки или user-provided context.
- **Runtime auditability.** Stored result и future markdown output включают
  schema version, command args, session/thread id и elapsed time.
- **Durable output remains opt-in.** Generic plugin не должен молча писать
  `reviewN.md` в repo, но future `--output` должен быть atomic, а future
  numbering mode должен иметь allocator/lock.

Оставляем за пределами plugin MVP:

- two-GREEN convergence loop
- automatic verdict application / plan edits
- fixed `projects/<queue>/<slug>` layout
- русскоязычную markdown schema как единственный формат
- same-runtime/opposite-runtime reviewer suffixes

Эти вещи хороши для `shift-happens`, но для plugin должны быть либо optional
repo workflow поверх structured result, либо отдельный future extension.

## Открытые вопросы дизайна

- Нужен ли в future output mode отдельный `--output-dir` с allocator/numbering
  или достаточно explicit `--output <file>`?

Решенные вопросы:

- MVP принимает любой UTF-8 text file, docs/examples рекомендуют Markdown.
- `coverage.area` остается свободной строкой с recommended values, а не hard
  enum, чтобы generic plugin не ломался на repo-specific областях.
- JSON finding object использует `requires_re_review: boolean`; markdown
  renderer может показывать это как yes/no.
- Runtime metadata принадлежит companion-owned stored job wrapper, а не model
  output.
- `approve` требует explicit coverage, но не требует искусственно проверять
  code/tests/docs, если область не применима.
- Default tone: нейтральный readiness review.
- Один plan file на run. Дополнительные материалы идут через будущий repeated
  `--context`, а не через multi-plan target.
- MVP хранит результат в stored job result. Repo file artifacts появляются только
  при explicit future `--output`.
- Historical `review*.md` не читаются по умолчанию.
- Plan-review command выполняет один review pass; convergence loops строятся
  внешним workflow поверх результата.
- Без `--wait` / `--background` slash-command wrapper спрашивает
  foreground/background так же, как текущие review commands; companion прямого
  интерактивного вопроса не задает.
- MVP background использует текущий Claude background Bash pattern, а не новый
  companion-side worker.
- `commands/plan-review.md` является thin wrapper: не читает plan/repo на
  Claude-side и возвращает companion stdout verbatim.
- Запрет tests/builds/migrations/docker enforced через companion audit/fail по
  `commandExecutions`, а не только через prompt-инструкцию.
- Unexpected `fileChanges` в captured app-server events тоже являются
  policy violation для plan-review.
- `requires_verify[].blocks_approval` делает связь между unresolved questions и
  verdict machine-checkable.
- Seed/result включают `plan_sha256`, чтобы stored result был привязан к
  конкретному содержимому плана, а не только к path.
