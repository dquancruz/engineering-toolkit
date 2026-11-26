---
id: threat-model
lang: es
---

# Checklist: threat model (STRIDE simple)

Cuándo usarlo: cuando un cambio toca autenticación, datos sensibles, entradas externas o infraestructura.

## Activos <!-- section: assets -->

- [ ] Los datos y capacidades que hay que proteger están listados
- [ ] Cada activo tiene un responsable y su nivel de sensibilidad

## Puntos de entrada y fronteras <!-- section: entry-points -->

- [ ] Todas las entradas (API, archivos, colas, administración) están listadas
- [ ] Están marcadas las fronteras de confianza que cruza cada flujo de datos

## S: suplantación de identidad <!-- section: spoofing -->

- [ ] Cada actor y servicio se autentica
- [ ] Las credenciales se rotan y se pueden revocar

## T: manipulación <!-- section: tampering -->

- [ ] Las entradas se validan en el servidor
- [ ] Los datos en tránsito y en reposo no se pueden alterar sin detectarlo

## R: repudio <!-- section: repudiation -->

- [ ] Las acciones sensibles quedan registradas con quién y cuándo
- [ ] Los registros no los puede borrar quien actúa

## I: divulgación de información <!-- section: information-disclosure -->

- [ ] Cada acceso comprueba autorización por recurso
- [ ] Errores y logs no exponen secretos ni datos personales

## D: denegación de servicio <!-- section: denial-of-service -->

- [ ] Hay límites de tamaño, frecuencia y tiempo
- [ ] Se sabe qué operación cara puede provocar un anónimo

## E: elevación de privilegios <!-- section: elevation-of-privilege -->

- [ ] Cada componente tiene solo los permisos que usa
- [ ] Las funciones de administración están separadas y protegidas

## Mitigaciones y seguimiento <!-- section: mitigations -->

- [ ] Cada amenaza tiene mitigación, o riesgo aceptado con quién lo acepta
- [ ] Cada mitigación pendiente tiene responsable y fecha
- [ ] Las mitigaciones importantes tienen una prueba

## Para un prompt <!-- prompt -->

Lo que `engkit prompt --checklist threat-model` agrega al prompt.

### Límites <!-- limits -->

- No dar una amenaza por mitigada sin señalar el control en el código o la configuración
- No ejecutar pruebas de ataque contra entornos sin autorización

### Verificación <!-- verify -->

- Cada punto de entrada se revisó contra las 6 categorías STRIDE
- Cada amenaza tiene mitigación o riesgo aceptado, y responsable
