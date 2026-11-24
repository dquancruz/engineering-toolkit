---
id: ai-prompt
lang: es
labels:
  question: Pregunta
  example: Ejemplo
  weak: Señales débiles
  checkable: Señales comprobables
strings:
  prompt_title: Prompt
  claude_limit: "Respeta las reglas y restricciones de {file}."
---

# Checklist: prompt para AI

Cuándo usarlo: antes de pedirle a una AI un trabajo que toque código o documentos. Sirve como lista de control y es la fuente de `engkit prompt`: las preguntas, ejemplos, señales y presets de abajo son los que usa la herramienta.

Un prompt claro tiene ocho elementos. Si no puedes responder alguno en una o dos frases, todavía no está listo.

## 1. Objetivo <!-- element: goal -->

**Pregunta:** ¿Qué quieres lograr, en una frase?

**Ejemplo:** Agregar paginación al endpoint `GET /orders` sin cambiar la respuesta para los clientes actuales.

**Señales débiles:** mejorar, optimizar, arreglar todo, limpiar, revisar un poco, que quede bien

- [ ] Es una sola frase y empieza con un verbo
- [ ] Dice el resultado esperado, no cómo lograrlo
- [ ] Alguien sin el contexto de la conversación lo entiende

## 2. Contexto <!-- element: context -->

**Pregunta:** ¿Qué necesita saber quien lo ejecute y no puede deducir del código?

**Ejemplo:** Los clientes móviles v1 dependen de que `items` sea un arreglo plano; hay una migración a v2 planificada.

- [ ] Solo incluye lo que no se deduce del código
- [ ] Enlaza a las fuentes en vez de copiarlas
- [ ] Cada dato importante dice de dónde sale

## 3. Material <!-- element: material -->

**Pregunta:** ¿Qué archivos, documentos o enlaces debe leer antes de empezar?

**Ejemplo:** `src/orders/handler.ts` y `docs/adr/0004-paginacion.md`

- [ ] Son rutas o enlaces, no contenido copiado
- [ ] Incluye los ADR aceptados que aplican
- [ ] No incluye claves, tokens ni valores de `.env`

## 4. Límites <!-- element: limits -->

**Pregunta:** ¿Qué no debe hacer o tocar?

**Ejemplo:** No cambiar el esquema de la base de datos. No agregar dependencias sin justificarlo.

**Señales débiles:** con cuidado, no rompas nada, lo que creas conveniente

- [ ] Hay al menos un límite explícito
- [ ] Cada límite se puede cumplir o violar de forma evidente
- [ ] Incluye las reglas del proyecto (por ejemplo `CLAUDE.md`)

## 5. Autonomía <!-- element: autonomy -->

**Pregunta:** ¿Cuándo debe detenerse y preguntarte en vez de decidir?

**Ejemplo:** Detenerse y preguntar si hay que cambiar la API pública, borrar datos o si fallan tests por una razón que no entiende.

**Señales débiles:** usa tu criterio, lo que veas mejor, decide tú

- [ ] Nombra situaciones concretas en las que debe parar
- [ ] Dice qué hacer con lo que no puede verificar

## 6. Criterio de terminado <!-- element: done -->

**Pregunta:** ¿Cómo sabrás que terminó? Tiene que poder comprobarse.

**Ejemplo:** `GET /orders?page=2&size=20` devuelve 20 elementos y el encabezado `X-Total-Count`, y `npm test` pasa.

**Señales débiles:** que funcione, que quede bien, funcione correctamente, mejor que antes

**Señales comprobables:** pasa, falla, devuelve, responde, código de salida, exit code, test, prueba, comando, lanza, muestra, es igual, cumple

- [ ] Se puede comprobar con un comando, una prueba o un resultado concreto
- [ ] Tiene números, nombres o valores exactos cuando aplica
- [ ] No depende de la opinión de quien lo hizo

## 7. Verificación <!-- element: verify -->

**Pregunta:** ¿Qué comandos o pasos ejecutarás para comprobarlo?

**Ejemplo:** `npm test`, `npx tsc --noEmit` y una llamada manual con `curl`.

**Señales débiles:** probar, revisar que ande, ver que funcione

- [ ] Cada paso es un comando o una acción repetible
- [ ] Dice qué resultado cuenta como correcto

## 8. Forma de la respuesta <!-- element: response -->

**Pregunta:** ¿En qué formato quieres la respuesta?

**Ejemplo:** Un resumen de 3 líneas, una tabla de archivos cambiados y lo que quedó pendiente.

- [ ] Indica el formato (resumen, tabla, diff, lista...)
- [ ] Pide separar lo verificado de lo no verificado

## Presets

Cada tipo de tarea precarga límites y verificación típicos. En `engkit prompt` los agregas con `--preset` o los eliges al empezar.

### Investigar o documentar <!-- preset: research -->

#### Límites <!-- limits -->

- No modificar código fuente ni configuración
- Citar la fuente de cada dato (archivo y línea, o enlace)
- Marcar como no verificado lo que no se pudo comprobar

#### Verificación <!-- verify -->

- Cada afirmación tiene su fuente
- Las rutas y los enlaces citados existen (`ls` o abrirlos)

### Feature <!-- preset: feature -->

#### Límites <!-- limits -->

- No cambiar la API pública sin preguntar
- No agregar dependencias sin justificarlo
- Mantener el estilo y las convenciones existentes

#### Verificación <!-- verify -->

- Los tests existentes pasan (`npm test` o el comando del proyecto)
- Hay pruebas nuevas para el comportamiento nuevo
- El typecheck y el linter pasan (por ejemplo `npx tsc --noEmit`)

### Bugfix <!-- preset: bugfix -->

#### Límites <!-- limits -->

- Cambiar lo mínimo necesario para corregir el defecto
- No refactorizar código que no esté relacionado
- No cambiar el comportamiento fuera del caso del defecto

#### Verificación <!-- verify -->

- Una prueba que reproduce el defecto falla antes del cambio y pasa después
- Los tests existentes pasan (`npm test` o el comando del proyecto)

### Refactor <!-- preset: refactor -->

#### Límites <!-- limits -->

- No cambiar el comportamiento observable
- No mezclar el refactor con cambios funcionales
- No modificar los tests existentes, salvo para renombrar
- Hacer cambios pequeños y revisables

#### Verificación <!-- verify -->

- Los tests existentes pasan sin modificarlos (`npm test` o el comando del proyecto)
- El typecheck y el linter pasan (por ejemplo `npx tsc --noEmit`)

### Review <!-- preset: review -->

#### Límites <!-- limits -->

- Solo lectura: no modificar archivos
- Indicar archivo y línea de cada hallazgo
- Separar defectos reales de preferencias de estilo

#### Verificación <!-- verify -->

- Cada hallazgo se puede reproducir o señalar en el código (`git diff` o abrir el archivo)
- Se indicó qué no se pudo verificar
