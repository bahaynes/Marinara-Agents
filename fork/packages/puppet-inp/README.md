# Inochi2D Puppet Reader (`puppet-inp`)

Inspect, manage, and load Inochi2D 2.5D animated `.inp` puppet models directly inside Marinara Engine.

## Features

- **TRNSRTS Binary Unpacking**: Native Node.js parser for big-endian Inochi2D archive containers.
- **Embedded Texture Extraction**: Serves embedded PNG texture pages directly through the package route `/puppets/:id/textures/:index`.
- **Parameter & Rig Inspector**: Groups facial expressions, eye blinking, mouth phonemes, and head transforms.
- **Home Browser Tab**: Integrated inspector UI panel registered under Home → Inochi2D.

## API Routes

- `GET /puppets`: Lists all currently loaded puppets in memory.
- `GET /puppets/:puppetId`: Retrieves the parsed JSON document and anatomical summary.
- `POST /load-path`: Loads and unpacks an `.inp` puppet from a local path (`{ "path": "C:/path/to/character.inp" }`).
- `GET /puppets/:puppetId/textures/:index`: Serves the specified texture page as raw image PNG.

## Testing

Run unit tests:

```bash
node --test fork/packages/puppet-inp/tests/*.test.mjs
```
