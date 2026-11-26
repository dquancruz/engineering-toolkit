---
id: code-review
lang: es
---

# Checklist: code review

Cuándo usarlo: antes de aprobar un pull request. Revisa la parte común y la del tipo de cambio.

## Común a todo PR <!-- section: common -->

- [ ] La descripción dice qué cambia y por qué
- [ ] El diff solo incluye lo que la descripción explica
- [ ] No hay secretos, datos personales ni archivos generados por error
- [ ] Los errores se manejan y los mensajes ayudan a entender el fallo
- [ ] Los nombres y el estilo siguen las convenciones del proyecto
- [ ] CI está en verde

## Feature <!-- section: feature -->

- [ ] El comportamiento nuevo cumple los criterios de aceptación
- [ ] Hay pruebas del caso normal, los bordes y los errores
- [ ] Los cambios de API o de datos son compatibles o tienen plan de migración
- [ ] La documentación de uso está actualizada
- [ ] Hay forma de observarlo en producción (logs, métricas) y de desactivarlo si hace falta

## Bugfix <!-- section: bugfix -->

- [ ] La causa está explicada, no solo el síntoma
- [ ] Hay una prueba que falla sin el cambio y pasa con él
- [ ] Se revisó si el mismo error existe en otros lugares
- [ ] El cambio es el mínimo necesario

## Refactor <!-- section: refactor -->

- [ ] El comportamiento observable no cambia
- [ ] Las pruebas existentes pasan sin modificarse
- [ ] No hay cambios funcionales mezclados
- [ ] El resultado es más simple que lo anterior

## Documentación <!-- section: docs -->

- [ ] Los comandos y ejemplos se ejecutaron
- [ ] Los enlaces y rutas existen
- [ ] Cada dato importante tiene fuente
- [ ] No duplica lo que ya está en otro documento

## Dependencias o configuración <!-- section: dependencies -->

- [ ] Se explica por qué se agrega o actualiza
- [ ] Se leyeron los cambios incompatibles de la versión nueva
- [ ] El lockfile cambia de forma coherente
- [ ] La auditoría de vulnerabilidades no empeora
- [ ] La licencia es aceptable
- [ ] Los cambios de configuración tienen valores por defecto seguros

## Para un prompt <!-- prompt -->

Lo que `engkit prompt --checklist code-review` agrega al prompt.

### Límites <!-- limits -->

- Indicar archivo y línea de cada hallazgo
- Separar defectos que bloquean de sugerencias

### Verificación <!-- verify -->

- La descripción del PR coincide con el diff (`git diff`)
- Se indicó qué no se pudo verificar

### Feature <!-- variant: feature -->

#### Límites <!-- limits -->

- No aprobar cambios de API sin compatibilidad o plan de migración

#### Verificación <!-- verify -->

- Hay pruebas del comportamiento nuevo, sus bordes y errores

### Bugfix <!-- variant: bugfix -->

#### Límites <!-- limits -->

- No aceptar cambios que no sean necesarios para corregir el defecto

#### Verificación <!-- verify -->

- La prueba del defecto falla sin el cambio y pasa con él

### Refactor <!-- variant: refactor -->

#### Límites <!-- limits -->

- No aceptar cambios de comportamiento observable

#### Verificación <!-- verify -->

- Las pruebas existentes pasan sin modificarse (`npm test` o el comando del proyecto)

### Documentación <!-- variant: docs -->

#### Límites <!-- limits -->

- No aprobar datos sin fuente

#### Verificación <!-- verify -->

- Los comandos de ejemplo se ejecutan y los enlaces abren

### Dependencias o configuración <!-- variant: dependencies -->

#### Límites <!-- limits -->

- No agregar dependencias sin justificarlo

#### Verificación <!-- verify -->

- La auditoría no reporta vulnerabilidades nuevas (`npm audit` o el comando del proyecto)
