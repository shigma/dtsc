# dtsc

[![npm](https://img.shields.io/npm/v/dtsc?style=flat-square)](https://www.npmjs.com/package/dtsc)
[![GitHub](https://img.shields.io/github/license/shigma/dtsc?style=flat-square)](https://github.com/shigma/dtsc/blob/master/LICENSE)

Generate bundled TypeScript declaration files.

## Usage

dtsc supports `outFile` option out of the box.

```json
// tsconfig.json
{
  "compilerOptions": {
    "outFile": "lib/index.d.ts",
  },
}
```

```json
// package.json
{
  "typings": "lib/index.d.ts",
  "scripts": {
    "build": "dtsc",
  },
}
```

```bash
npm run build
```

## Limitations

This package uses a string-based approach to generate bundle from a .d.ts file. It has some limitations:

- If you find one, welcome to report an issue.

<!-- In most cases I would recommend using tsc directly. -->
