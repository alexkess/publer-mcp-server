

# Publer MCP Server

Un servidor de código abierto del [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) para la API de gestión de redes sociales de [Publer](https://publer.com).

Programa publicaciones, sube multimedia, obtén analíticas y administra cuentas en más de 15 redes sociales, todo desde tu asistente de IA.

Creado por [Kess Media](https://kess.media)

## Características

- **14 herramientas** que cubren toda la API de Publer
- Crear, programar, publicar, actualizar y eliminar publicaciones
- Subir multimedia mediante URL (ideal para integración con Dropbox/almacenamiento en la nube)
- Explorar y buscar en la biblioteca de multimedia
- Analíticas: gráficos, estadísticas de publicaciones, análisis de hashtags, mejores horarios para publicar
- Publicación en múltiples cuentas en Facebook, Instagram, X, LinkedIn, TikTok, YouTube, Bluesky y más
- Verificación asíncrona (polling) de trabajos para la creación de publicaciones y subida de multimedia

## Requisitos

- Node.js 18+
- Plan Business de Publer (el acceso a la API es exclusivo para Business)
- Clave API de Publer ([Configuración → Acceso e inicio de sesión → Claves API](https://publer.com/help/en/article/how-to-access-the-publer-api-1w08edo/))

## Inicio rápido

### Aplicación de escritorio de Claude / Claude Code Desktop (Mac)

Edita `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "publer": {
      "command": "npx",
      "args": ["-y", "publer-mcp-server"],
      "env": {
        "PUBLER_API_KEY": "your-api-key-here",
        "PUBLER_WORKSPACE_ID": "your-workspace-id-here"
      }
    }
  }
}
```

Reinicia la aplicación; Publer aparecerá bajo **Connectors → Desktop**.

### Claude Code (CLI)

Agrega lo siguiente a `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "publer": {
      "command": "npx",
      "args": ["-y", "publer-mcp-server"],
      "env": {
        "PUBLER_API_KEY": "your-api-key-here",
        "PUBLER_WORKSPACE_ID": "your-workspace-id-here"
      }
    }
  }
}
```

O mediante la CLI:

```bash
claude mcp add publer -- npx -y publer-mcp-server \
  --env PUBLER_API_KEY=your-key \
  --env PUBLER_WORKSPACE_ID=your-workspace-id
```

### Cloudflare Worker (Remoto: sin instalación local)

Despliega como un Cloudflare Worker y conéctate desde cualquier interfaz de Claude sin instalar nada localmente. Un solo despliegue, múltiples usuarios.

**Despliegue:**

```bash
git clone https://github.com/alexkess/publer-mcp-server.git
cd publer-mcp-server/worker
npm install
npx wrangler deploy
npx wrangler secret put PUBLER_API_KEY
npx wrangler secret put PUBLER_WORKSPACE_ID
```

Tu servidor ya está activo en `https://publer-mcp.<your-subdomain>.workers.dev/mcp`.

**Conectar desde Claude Code (`~/.claude/mcp.json`):**

```json
{
  "mcpServers": {
    "publer": {
      "type": "http",
      "url": "https://publer-mcp.<your-subdomain>.workers.dev/mcp"
    }
  }
}
```

**Conectar desde Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`):**

La interfaz de Connectors de la aplicación de escritorio no admite servidores MCP HTTP personalizados directamente. Usa la configuración de Claude Code anterior, o agrega la URL mediante el flujo de conector personalizado en **Settings → Connectors → +**.

**Nota de seguridad:** La URL del Worker actúa como tu credencial de acceso; manténla privada. Cada usuario despliega su propio Worker con su propia clave API de Publer, por lo que no hay riesgo de acceso compartido.

### Cursor

Agrega lo siguiente a `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "publer": {
      "command": "npx",
      "args": ["-y", "publer-mcp-server"],
      "env": {
        "PUBLER_API_KEY": "your-api-key-here",
        "PUBLER_WORKSPACE_ID": "your-workspace-id-here"
      }
    }
  }
}
```

## Variables de entorno

| Variable | Obligatoria | Descripción |
|---|---|---|
| `PUBLER_API_KEY` | Sí | Tu clave API de Publer |
| `PUBLER_WORKSPACE_ID` | Sí | Tu ID de espacio de trabajo de Publer |

### Cómo encontrar tu ID de espacio de trabajo

**Opción 1: Desde la API**

```bash
curl -H "Authorization: Bearer-API YOUR_API_KEY" https://app.publer.com/api/v1/me
```

Tus IDs de espacio de trabajo están en el array `workspaces` de la respuesta.

**Opción 2: Desde la URL de Publer**

Inicia sesión en Publer, abre las herramientas para desarrolladores de tu navegador (F12), ve a la pestaña Network (Red) y busca cualquier solicitud a la API; el encabezado `Publer-Workspace-Id` muestra tu ID de espacio de trabajo.

## Herramientas disponibles

### Gestión de cuentas

| Herramienta | Descripción |
|---|---|
| `publer_get_me` | Obtener el perfil del usuario autenticado actualmente |
| `publer_list_workspaces` | Listar todos los espacios de trabajo |
| `publer_list_accounts` | Listar todas las cuentas sociales conectadas |

### Publicaciones

| Herramienta | Descripción |
|---|---|
| `publer_list_posts` | Listar y filtrar publicaciones por estado, fecha, tipo, cuenta o búsqueda |
| `publer_create_post` | Crear y programar una publicación (texto, foto, video, carrusel, etc.) |
| `publer_publish_post_now` | Publicar una publicación de inmediato |
| `publer_update_post` | Actualizar una publicación existente |
| `publer_delete_post` | Eliminar una publicación |

### Multimedia

| Herramienta | Descripción |
|---|---|
| `publer_upload_media_from_url` | Importar multimedia desde una URL (Dropbox, almacenamiento en la nube, etc.) |
| `publer_list_media` | Explorar y buscar en la biblioteca de multimedia |

### Trabajos (Jobs)

| Herramienta | Descripción |
|---|---|
| `publer_get_job_status` | Consultar el estado de trabajos asíncronos (creación de publicaciones, subida de multimedia) |

### Analíticas

| Herramienta | Descripción |
|---|---|
| `publer_get_analytics` | Obtener gráficos de analíticas (seguidores, alcance, interacciones) |
| `publer_get_post_insights` | Obtener métricas de rendimiento por publicación |
| `publer_get_hashtag_analysis` | Analizar el rendimiento de hashtags |
| `publer_get_best_times` | Obtener mapa de calor de los mejores horarios para publicar |

## Ejemplos de flujos de trabajo

### Programar una publicación con foto

```
"Sube esta imagen desde mi Dropbox a Publer y luego prográmala 
en mi cuenta de Bluesky de Alex Kess para el jueves a las 10:00 a. m. (AEST) 
con el texto 'Cronulla desde arriba'."
```

El asistente de IA realizará lo siguiente:
1. Llamar a `publer_upload_media_from_url` con el enlace de Dropbox
2. Consultar `publer_get_job_status` hasta que se complete la subida
3. Llamar a `publer_create_post` con el ID de multimedia, el texto, el ID de la cuenta y el horario programado

### Comprobar el rendimiento de las publicaciones

```
"¿Cómo se desempeñaron mis publicaciones la semana pasada en Instagram?"
```

El asistente de IA realizará lo siguiente:
1. Llamar a `publer_list_accounts` para encontrar el ID de la cuenta de Instagram
2. Llamar a `publer_get_post_insights` con el rango de fechas
3. Mostrar los resultados

## Desarrollo

```bash
git clone https://github.com/alexkess/publer-mcp-server.git
cd publer-mcp-server
npm install
npm run build
```

### Ejecutar localmente

```bash
PUBLER_API_KEY=your-key PUBLER_WORKSPACE_ID=your-id npm start
```

## Redes compatibles

Facebook, Instagram, X (Twitter), LinkedIn, Pinterest, YouTube, TikTok, Google Business Profile, WordPress, Telegram, Mastodon, Threads, Bluesky.

## Licencia

MIT — consulta [LICENSE](LICENSE)

## Contribuciones

¡Las PR son bienvenidas! Este es un proyecto de código abierto de [Kess Media](https://kess.media).
