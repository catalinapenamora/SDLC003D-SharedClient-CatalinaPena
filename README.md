# TechMarket · Blue-Green en K3s

**Evaluación Final Transversal · AUY1104**
**Catalina Peña Mora**

---

Pipeline de despliegue para `demo-api`: GitHub Actions + Docker Hub + en clúster K3s sobre EC2 (haciendo el papel de EKS/ECR).
Se explica cómo está armada la infraestructura, cómo funciona el despliegue Blue-Green, y qué gatilla el rollback cuando algo sale mal.

---

## 1. Arquitectura

El proyecto vive en dos repos, para no repetir la lógica de CI/CD si mañana hay otro microservicio, mencionándose a continuación los componentes más importantes:

```
SDLC003D-SharedClient-CatalinaPena.     (este repo)
 ├─ .github/workflows/client.yaml       → dispara el pipeline, delega el trabajo
 ├─ k8s/deployment.yaml                 → Deployments demo-api-blue / demo-api-green
 ├─ k8s/service.yaml                    → único Service, apunta al color activo
 ├─ src/index.js                        → app Express (incluye endpoint /health)
 ├─ Dockerfile
 └─ server.js

SDLC003D-SharedWorkflows-CatalinaPena
 └─ .github/workflows/deploy-api.yaml   → receta reutilizable (build, push, deploy)
```

`client.yaml` no construye ni despliega nada por sí mismo, ya que invoca a `deploy-api.yaml` como workflow reutilizable (`workflow_call`), pasándole el nombre e imagen del proyecto, la IP del servidor K3s y los secretos necesarios (Docker Hub + llave SSH). Cambiar de servicio en el futuro es solo cuestión de cambiar esos parámetros, no de reescribir el pipeline.

Flujo de principio a fin:

```
push tag v*.*.* 
   │
   ▼
deps-and-test  (npm install + npm test)
   │
   ▼
build-and-push (docker build → docker push a Docker Hub)
   │
   ▼
deploy-to-k8s  (SSH al nodo K3s, aplica manifiestos, ejecuta blue-green)
```

Cada etapa depende (`needs:`) de que la anterior termine bien — si los tests fallan, nunca se construye ni se publica una imagen rota, siendo esta una de las mejores prácticas para la detección temprana de fallos.

---

## 2. Estrategia de despliegue: Blue-Green nativo

El cambio de tráfico se maneja directamente moviendo el `selector` del `Service` de Kubernetes con `kubectl patch`. Toda la lógica vive en un solo step del job `deploy-to-k8s`:

**Paso 1 — Detectar el color activo.** Se lee el selector actual del `Service demo-api` (`color: blue` o `color: green`). El color contrario es el "ambiente silencioso" donde se va a desplegar la nueva versión.

**Paso 2 — Actualizar la imagen en el ambiente silencioso.** Se hace `kubectl set image` sobre el Deployment del color inactivo, apuntándolo a la imagen recién publicada en Docker Hub. El color que sigue sirviendo tráfico real **no se toca**.

**Paso 3 — Esperar a que el pod nuevo esté listo.** `kubectl rollout status` bloquea la ejecución hasta que el nuevo pod pasa sus probes de `readiness`/`liveness`, o hace timeout si nunca llega a ese estado.

**Paso 4 — Validación de salud activa.** Este es el punto clave: en lugar de confiar solo en que Kubernetes marque el pod como "Ready", el pipeline obtiene la IP interna del pod nuevo y le hace una petición HTTP directa a `/health` — sin pasar por el Service, porque el Service todavía apunta al color viejo en este momento. Se evalúan dos condiciones a la vez:

- código de respuesta `200`
- tiempo de respuesta bajo un umbral definido (2 segundos)

Se reintenta unas cuantas veces antes de dar por fallida la validación, para no reaccionar a una demora puntual de arranque como si fuera una falla real.

**Paso 5 — Conmutar tráfico.** Solo si el paso 4 fue exitoso, se aplica `kubectl patch` sobre el `Service` para mover su selector al nuevo color. El cambio de tráfico es efectivamente instantáneo: no hay periodo de transición, un momento el 100% del tráfico va al color viejo y al siguiente va al nuevo.

¿Por qué Blue-Green y no rolling update? Porque acá hay **dos versiones completas corriendo en paralelo**: la nueva se puede probar de verdad (el `curl` directo al pod) sin que ningún usuario la toque hasta que quede confirmada como sana.

---

## 3. Cómo se activa la remediación automática

El job tiene un último step:

```yaml
- name: Rollback Automático de Emergencia
  if: failure()
  run: |
    kubectl patch svc demo-api -p '{"spec":{"selector":{"color":"'$COLOR_ACTUAL'"}}}'
    kubectl rollout undo deployment/demo-api-$COLOR_NUEVO
```

La condición `if: failure()` hace que este step **solo corra si algo antes falló** — no importa qué: rollout con timeout, un `500` en la validación de salud, latencia alta, o cualquier otro tropiezo de infraestructura. GitHub Actions propaga el estado de fallo automáticamente, así que no hay que revisar manualmente cuál fue la causa.

Al activarse, el rollback hace dos cosas:

1. **Refuerza el `Service` hacia el color estable**, incluso si en teoría nunca se movió — es una garantía explícita, no una suposición.
2. **Revierte el Deployment fallido** con `kubectl rollout undo`, dejando ese ambiente limpio para el siguiente intento.

Un detalle que vale la pena tener claro: aunque el rollback funcione perfecto, **el job sigue mostrándose como fallido** en GitHub Actions. Es a propósito — el rollback protege a los usuarios, no maquilla el resultado. El equipo necesita saber que el despliegue no llegó a buen puerto, aunque el sistema ya se haya cuidado solo.

---

## Notas de implementación

Antes de llegar a esta versión, el pipeline pasó por varias fallas reales: una imagen Docker sin el punto de entrada de la app, un nombre de imagen fijo que se reescribía en cada `apply`, una ruta de `require` que no calzaba con la estructura real del proyecto, y dos `Service` compitiendo por el mismo nombre. Cada una disparó el rollback como corresponde — buena señal de que la validación de salud no depende de un solo tipo de error para reaccionar.