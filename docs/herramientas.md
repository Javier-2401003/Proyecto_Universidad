# Herramientas del proyecto: licencia y costo

Regla del proyecto: la única herramienta de pago es la suscripción de Claude.
Todo lo demás debe ser gratuito, sin tokens ni créditos.

| Herramienta | Uso | Licencia | ¿Gratuita? | Decisión |
|---|---|---|---|---|
| React | Frontend | MIT | Sí | Usar |
| Node.js + Express | Backend / API | MIT | Sí | Usar |
| MySQL 8 Community (en Wamp) | Base de datos | GPL | Sí | Usar |
| phpMyAdmin | Administrar la BD | GPL | Sí | Usar |
| Git + GitHub (repositorio público) | Control de versiones | GPL / servicio gratuito | Sí | Usar |
| OpenAI Whisper (local) | Transcripción | MIT | Sí, sin API ni tokens | Usar (modelo `base` o `small`) |
| librosa (Python) | Análisis acústico: tono (F0) y volumen (RMS) | ISC | Sí | Usar |
| openSMILE | Análisis acústico | Licencia propia: gratis para investigación, **de pago para uso comercial** | Solo uso académico | **No usar**; librosa cubre lo que pide el Blueprint (RN-02) |
| Lucide / Font Awesome Free | Iconos | ISC / CC BY 4.0 | Sí | Usar (sin emojis) |
| ffmpeg | Leer MP3 y convertir audio | LGPL/GPL | Sí | Usar (lo exige Whisper) |
| Claude (suscripción) | Guía, código, revisión | Servicio | **Pago** (única excepción autorizada) | Usar |

## Alternativas gratuitas a lo que menciona el Blueprint

| El Blueprint menciona | Problema | Alternativa gratuita |
|---|---|---|
| FastAPI, SQLAlchemy, Flyway, Spring Security | Es otro stack (Python/Java), distinto del Prompt Maestro | Express + `mysql2` + scripts SQL + JWT/Bcrypt (ya implementado) |
| PostgreSQL | El Blueprint también dice MySQL; el equipo eligió MySQL | MySQL 8 en Wamp |
| Redis, MinIO, Nginx, Docker | Complejidad innecesaria para el mínimo funcional | Memoria del servidor, carpeta local `backend/uploads/` (RN-05 lo permite) |
| Prometheus, Grafana, Loki | Fuera del mínimo funcional | Registros en consola (`console.log`) |
| SendGrid / SMTP | No es indispensable | Fuera del prototipo |
| Servicios en la nube de pago (AWS, Google, Azure) | Prohibidos por el propio Blueprint | Whisper local |
| Análisis de sentimiento con modelos de HuggingFace (pysentimiento) | Pesado (PyTorch) para laptops de 8 GB | Léxico en español basado en RN-01, ponderado 55 %; ampliable más adelante |
