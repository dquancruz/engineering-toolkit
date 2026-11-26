---
id: definition-of-done
lang: es
---

# Checklist: Definition of Done

Cuándo usarlo: antes de dar por terminada una historia o tarea.

## Comportamiento <!-- section: behavior -->

- [ ] Cumple cada criterio de aceptación
- [ ] Los casos de error y de borde están resueltos
- [ ] Alguien lo probó en un entorno parecido a producción

## Calidad <!-- section: quality -->

- [ ] Hay pruebas automáticas del comportamiento nuevo
- [ ] Pruebas, typecheck y linter pasan en CI
- [ ] El código fue revisado y los comentarios resueltos
- [ ] No quedan TODO sin un pendiente que los registre

## Entrega <!-- section: delivery -->

- [ ] La documentación afectada está actualizada
- [ ] Las decisiones importantes quedaron en un ADR
- [ ] La configuración, migraciones y permisos necesarios están listos
- [ ] Se sabe cómo observarlo y cómo revertirlo

## Para un prompt <!-- prompt -->

Lo que `engkit prompt --checklist definition-of-done` agrega al prompt.

### Límites <!-- limits -->

- No dar la tarea por terminada si queda un criterio sin comprobar

### Verificación <!-- verify -->

- Cada criterio de aceptación se comprobó, indicando cómo
- Pruebas, typecheck y linter pasan (`npm test` o el comando del proyecto)
- La documentación afectada se actualizó o se indicó que no cambia
