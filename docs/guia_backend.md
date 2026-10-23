# Guía: cómo se construye un endpoint del backend

Esta guía explica, paso a paso, cómo se agrega una función nueva a la API de VocalAnalytics.
Usa como ejemplo real **asignar supervisor** (`PUT /api/v1/usuarios/:id_usuario/supervisor`),
pero el proceso es el mismo para cualquier endpoint. Al final hay una lista de verificación.

El orden importa: **primero se acuerda qué hace (contrato), después se programa, después se
prueba y al final se documenta y se pide revisión.**

---

## Paso 0. Preparar el terreno (Git)

Siempre se parte de lo último de `main` y se trabaja en una rama propia (nunca directo en `main`):

```bash
git switch main
git pull origin main
git switch -c willy-gestion-usuarios
```

- El nombre sigue la regla del equipo: `persona-tarea`, con guion (ver `CLAUDE.md`).
- Si la tarea necesita código de un PR que todavía no se fusiona, se crea la rama a partir de
  esa otra rama (se llama "rama apilada"). Si no, siempre desde `main`.

**Antes de escribir código, mira en qué rama estás** (`git status`). Si cambiaste de rama
para probar algo (por ejemplo la rama de Javier para ver su pantalla), vuelve a la tuya con
`git switch willy-gestion-usuarios` antes de seguir; si no, tus cambios caen en la rama equivocada.

**En el ejemplo** se hicieron dos ramas:
1. `willy-contrato-gestion-usuarios`: solo el contrato en `docs/api.md`.
2. `willy-gestion-usuarios`: el código, creada a partir de la anterior.

¿Por qué separadas? Porque `CLAUDE.md` pide que un cambio de contrato vaya en su propio PR:
así Javier revisa primero *qué* va a hacer la API (lo que a él le importa para el frontend)
sin tener que leer el código.

---

## Paso 1. El contrato: decidir qué hace el endpoint

Antes de programar se escribe en `docs/api.md`:

| Qué se define | Ejemplo (asignar supervisor) |
|---|---|
| Método y ruta | `PUT /usuarios/:id_usuario/supervisor` |
| Permiso | `GESTION_USUARIOS` escribir |
| Cuerpo que recibe | `{ "id_supervisor": 5 }` o `null` para quitarlo |
| Respuesta correcta | `200` con el usuario actualizado |
| Errores, con código | `400 NO_ES_AGENTE`, `400 SUPERVISOR_INVALIDO`, `404 NO_ENCONTRADO`... |
| Auditoría | `ASIGNACION_SUPERVISOR` con lo que cambió |
| Decisiones de negocio | "un agente tiene como máximo un supervisor" |

**Cómo elegir el método HTTP:**
- `GET` leer, `POST` crear algo nuevo.
- `PUT` reemplazar un valor completo (el supervisor de un agente: se pone uno y reemplaza al anterior).
- `PATCH` cambiar solo algunos campos (editar nombre o correo).
- Repetir un `PUT` igual no debe cambiar nada (por eso, si el supervisor ya era el mismo, no
  se escribe nada ni se audita).

**Las decisiones se escriben**, aunque parezcan obvias: lo que no está en el repositorio, los
demás no lo saben.

---

## Paso 2. Revisar la base de datos

Antes de programar hay que saber qué tablas se tocan y qué reglas ya garantiza MySQL.
Están en `database/01_esquema.sql` y explicadas en `docs/modelo_datos.md`.

En el ejemplo, `TB_AsignacionSupervisor`:
- Tiene `UNIQUE (id_supervisor, id_agente)`: la misma pareja no se repite.
- Tiene `CHECK (id_supervisor <> id_agente)`: nadie se supervisa a sí mismo.
- **No** impide que un agente tenga dos supervisores, ni comprueba los roles. Eso lo tiene
  que validar el backend (lo dice `docs/modelo_datos.md`).

Regla: **lo que la base no garantiza, lo valida el código.** Si hiciera falta cambiar una
tabla, se crea un script nuevo `database/04_...sql`; nunca se editan los scripts ya aplicados.

---

## Paso 3. Programar la ruta

Las rutas viven en `backend/src/routes/`. Cada endpoint sigue siempre el mismo recorrido:

```
petición → autenticar → requierePermiso → validar entrada → reglas de negocio
         → transacción (cambios + auditoría) → respuesta
```

Así quedó en `backend/src/routes/usuarios.js` (resumido):

```js
rutasUsuarios.put(
  '/:id_usuario/supervisor',
  autenticar,                                       // 1. ¿Quién eres? (token válido y usuario activo)
  requierePermiso('GESTION_USUARIOS', 'escribir'),  // 2. ¿Puedes hacer esto? (si no, 403)
  async (req, res) => {
    // 3. Validar la entrada con zod. Si no cumple, validar() responde 400 DATOS_INVALIDOS solo.
    const { id_usuario: idAgente } = validar(esquemaIdUsuario, req.params);
    const { id_supervisor: idSupervisor } = validar(esquemaAsignarSupervisor, req.body ?? {});

    // 4. Reglas de negocio: cada una lanza un ErrorHttp con su código del contrato.
    const agente = await buscarUsuario(idAgente);           // 404 si no existe
    if (!agente.roles.includes('AGENTE')) {
      throw new ErrorHttp(400, 'NO_ES_AGENTE', 'Solo se puede asignar supervisor a un agente.');
    }
    // ... comprobar que el supervisor existe, está activo y tiene rol SUPERVISOR ...

    // 5. Cambios + auditoría en UNA transacción: o se guarda todo, o nada.
    await conTransaccion(async (conexion) => {
      await conexion.execute('DELETE FROM TB_AsignacionSupervisor WHERE id_agente = ?', [idAgente]);
      await conexion.execute('INSERT INTO TB_AsignacionSupervisor ... VALUES (?, ?)', [...]);
      await conexion.execute('INSERT INTO TB_LogAuditoria ...', [...]);
    });

    // 6. Responder lo que dice el contrato.
    res.json(await buscarUsuario(idAgente));
  }
);
```

Lo importante de cada pieza:

- **`autenticar` y `requierePermiso`** (`src/middleware/auth.js`): se ponen en ese orden en
  toda ruta protegida. Los permisos se leen de la base en cada petición, así que si el
  SuperAdmin cambia un permiso, aplica al instante.
- **zod** (`validar()` en `src/errores.js`): describe cómo debe ser el dato y rechaza el resto.
  `z.coerce.number()` se usa para la ruta (`:id_usuario` siempre llega como texto) y
  `z.number()` para el cuerpo JSON (ahí `"5"` en texto debe rechazarse).
- **`ErrorHttp`**: `throw new ErrorHttp(estado, 'CODIGO', 'mensaje para mostrar', detalles?)`.
  El manejador central de `src/app.js` lo convierte al formato de errores de la API. En
  Express 5 basta con `throw` dentro de una función `async`; no hace falta `try/catch`.
- **Consultas siempre con `?`**: `consultar('... WHERE id = ?', [id])`. Nunca se pegan datos
  del usuario dentro del texto SQL (eso abre la puerta a inyección SQL).
- **Transacción** (`conTransaccion` en `src/db.js`): si algo falla a medias, MySQL deshace
  todo. Sin ella, podría quedar un agente sin supervisor y sin registro de por qué.
- **Auditoría**: todo cambio de datos se registra en `TB_LogAuditoria` (quién, qué, desde qué IP).
  Nunca se guardan contraseñas ni hashes.
- **Reutilizar**: `buscarUsuarios()` arma la misma forma de usuario para `GET /usuarios` y para
  las respuestas de los cambios, así el frontend recibe siempre lo mismo.

Si la ruta es de un grupo nuevo (por ejemplo `/agentes`), se crea su archivo en
`src/routes/` y se registra en `src/app.js` con `app.use('/api/v1/...', rutas...)`.

### Segundo ejemplo: editar (`PATCH`) y desactivar

`PATCH /usuarios/:id_usuario` y `PATCH /usuarios/:id_usuario/estado` siguen el mismo recorrido,
pero agregan cuatro ideas que sirven para muchos endpoints de "editar":

1. **Campos opcionales, pero al menos uno.** En zod cada campo lleva `.optional()` y al final
   `.refine(...)` exige que venga alguno. `.strict()` rechaza campos que no existen: así, si el
   frontend manda `password` por error, recibe un 400 en lugar de creer que la cambió.
2. **Comparar antes de guardar.** Se arma un objeto `cambios` solo con lo que es distinto del
   valor actual. Si queda vacío, se responde sin tocar la base ni la auditoría. Si no, la
   auditoría guarda `{ anterior, nuevo }` de cada campo: así se puede reconstruir qué pasó.
3. **Efectos secundarios en la misma transacción.** Cambiar el rol obliga a limpiar las
   asignaciones que ya no tienen sentido (un ex agente no puede tener supervisor). Se hace
   dentro de la misma `conTransaccion` que el cambio de rol: o pasa todo, o nada.
4. **Protegerse de errores del propio usuario.** Nadie puede quitarse su rol ni desactivarse:
   se compara `idUsuario === req.usuario.id` (el usuario de la ruta con el que hace la petición).

Un detalle que se descubrió aquí: `TB_Rol` no distingue mayúsculas (su collation es `_ci`),
así que `'supervisor'` también encuentra el rol, pero en JavaScript `'supervisor' !== 'SUPERVISOR'`.
Por eso el esquema convierte el rol con `.toUpperCase()` antes de usarlo. **Cuando el código
compara textos que vienen de la base, hay que normalizarlos igual que los guarda la base.**

Y no hace falta código extra para que desactivar "corte" la sesión: el middleware
`autenticar` ya revisa en cada petición que el usuario esté `ACTIVO`.

---

## Paso 4. Probar

Las pruebas están en `backend/tests/` y usan el probador que trae Node (`node:test`).
Se ejecutan contra la base real de tu equipo:

```bash
cd backend
npm test
```

Cómo está armado `tests/usuarios.test.js`:

1. **`before`**: levanta la API en un puerto libre, inicia sesión como SuperAdmin (con
   `SEED_ADMIN_*` de tu `.env`) y crea **sus propios usuarios de prueba** con correos únicos
   (`test.….<fecha>@ejemplo.test`).
2. **Una prueba por cada comportamiento del contrato**: el caso correcto, cada código de error,
   el permiso (403) y la auditoría. Si el contrato dice que algo pasa, hay una prueba que lo comprueba.
3. **`after`**: borra todo lo que creó, para que la base quede igual que antes.

Qué probar siempre:
- El caso correcto y que el cambio de verdad quedó en la base (no solo la respuesta).
- Cada error del contrato, con su estado y su `codigo`.
- Que un rol sin permiso recibe `403`.
- Que la auditoría se registró con el detalle correcto.
- Los casos raros: repetir la misma petición, valores `null`, datos mal formados.

**Pruebas que cambian cosas delicadas.** Para probar "nadie puede desactivarse a sí mismo" no se
usa tu SuperAdmin real: la prueba crea un segundo SuperAdmin y lo intenta con él. Si el código
tuviera un error, quedaría desactivado el usuario de prueba, no el tuyo. Después de correr
pruebas así, conviene comprobar en phpMyAdmin que no quedaron usuarios `test.%` y que tu
SuperAdmin sigue `ACTIVO`.

**Claves foráneas al limpiar.** `TB_LogAuditoria` apunta al usuario que hizo cada cambio
(`ON DELETE RESTRICT`), así que para borrar un usuario de prueba que hizo cambios primero hay
que borrar su auditoría (lo hace el `after` de `tests/usuarios.test.js`).

`npm test` debe pasar completo antes de abrir el PR.

---

## Paso 5. Documentar

- `docs/api.md`: cambiar el estado del endpoint de "Propuesto, pendiente" a "Hecho".
- `docs/avance.md`: actualizar **solo tu sección** (hecho, pendiente, qué necesitas de otros).

---

## Paso 6. Commit, PR y revisión

```bash
git add <archivos que cambiaste>
git commit
git push -u origin willy-gestion-usuarios
gh pr create --base main --title "..." --body "..."
gh pr edit <número> --add-reviewer Javier-2401003
```

- En `git add` se nombran los archivos uno por uno (no `git add .`), para no subir por error
  `.env`, audios o `uploads/`.
- El mensaje del commit dice qué cambió y por qué.
- En el PR se explica qué hace, qué decisiones hay que confirmar y cómo se probó.
- Otro integrante lo revisa antes de fusionarlo con `main`.

---

## Lista de verificación

- [ ] Rama nueva desde `main` actualizado (o apilada, si depende de otro PR).
- [ ] Contrato escrito en `docs/api.md` (y en su propio PR si es nuevo o cambia).
- [ ] Revisé qué garantiza la base y qué tengo que validar yo.
- [ ] La ruta usa `autenticar` + `requierePermiso` + `validar()`.
- [ ] Cada error del contrato sale con `ErrorHttp` y su código exacto.
- [ ] Consultas con `?`; cambios en `conTransaccion`; auditoría sin contraseñas.
- [ ] Pruebas para el caso correcto, cada error, el 403 y la auditoría; limpian lo que crean.
- [ ] `npm test` pasa completo.
- [ ] `docs/api.md` y mi sección de `docs/avance.md` actualizados.
- [ ] PR con descripción y revisor asignado.
